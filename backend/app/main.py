import json
import os
import re
from typing import Any

import httpx
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload

from .database import Base, engine, get_db
from .models import Attachment, Category, Location, User
from .schemas import (
    AttachmentRead,
    CategoryUpdate,
    ExportPayload,
    LocationCreate,
    LocationRead,
    LocationUpdate,
    LoginRequest,
    NocoRowsRequest,
    NocoRowsResponse,
    NocoTableRead,
    StatsRead,
    TokenResponse,
    UserCreate,
    UserRead,
    UserUpdate,
)
from .security import create_access_token, get_current_user, hash_password, normalize_role, require_roles, verify_password

app = FastAPI(title="Geo Intel Service", version="0.6.0")

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ROLE_OPTIONS = {"admin", "editor", "viewer"}

NOCODB_BASE_URL = os.getenv("NOCODB_BASE_URL", "").rstrip("/")
NOCODB_API_TOKEN = os.getenv("NOCODB_API_TOKEN", "")
NOCODB_BASE_ID = os.getenv("NOCODB_BASE_ID", "")
ALLOWED_NOCODB_OPERATORS = {"eq", "neq", "not", "gt", "ge", "lt", "le", "like", "nlike", "is", "isnot", "in", "allof", "anyof"}
DEFAULT_PASSWORDS = {
    "admin": os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123456"),
    "editor": os.getenv("DEFAULT_EDITOR_PASSWORD", "editor123456"),
    "viewer": os.getenv("DEFAULT_VIEWER_PASSWORD", "viewer123456"),
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    seed_default_users()


def ensure_schema() -> None:
    statements = [
        "ALTER TABLE locations ADD COLUMN IF NOT EXISTS marker_color VARCHAR(32) DEFAULT '#4f8cff'",
        "ALTER TABLE locations ADD COLUMN IF NOT EXISTS marker_icon VARCHAR(32) DEFAULT '🏗️'",
        "ALTER TABLE locations ADD COLUMN IF NOT EXISTS image_stored_name VARCHAR(255)",
        "ALTER TABLE locations ADD COLUMN IF NOT EXISTS image_original_name VARCHAR(255)",
        "ALTER TABLE locations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()",
        "ALTER TABLE locations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()",
        "CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(120) UNIQUE NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255), role VARCHAR(50) NOT NULL DEFAULT 'viewer', is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT NOW())",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)",
        "CREATE TABLE IF NOT EXISTS attachments (id SERIAL PRIMARY KEY, location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE, category_id INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL, stored_name VARCHAR(255) UNIQUE NOT NULL, original_name VARCHAR(255) NOT NULL, content_type VARCHAR(120), size_bytes INTEGER NOT NULL DEFAULT 0, uploaded_at TIMESTAMP NOT NULL DEFAULT NOW())",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS modules_json TEXT",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS table_json TEXT",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS nocodb_table_id VARCHAR(120)",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS nocodb_table_name VARCHAR(255)",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS nocodb_filters_json TEXT",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS nocodb_visible_columns_json TEXT",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS nocodb_available_columns_json TEXT",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def seed_default_users() -> None:
    with Session(engine) as db:
        defaults = [
            ("admin", "admin@example.com", "admin"),
            ("editor", "editor@example.com", "editor"),
            ("viewer", "viewer@example.com", "viewer"),
        ]
        for username, email, role in defaults:
            user = db.execute(select(User).where(User.username == username)).scalars().first()
            password_hash = hash_password(DEFAULT_PASSWORDS[username])
            if not user:
                db.add(User(username=username, email=email, password_hash=password_hash, role=role, is_active=True))
            else:
                changed = False
                if not user.password_hash:
                    user.password_hash = password_hash
                    changed = True
                if user.email.endswith(".local"):
                    user.email = email
                    changed = True
                if user.role != role:
                    user.role = role
                    changed = True
                if changed:
                    db.add(user)
        db.commit()


def build_location_image_url(location: Location) -> str | None:
    if not location.image_stored_name:
        return None
    return f"/locations/{location.id}/image"


def attachment_to_read(attachment: Attachment) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        location_id=attachment.location_id,
        category_id=attachment.category_id,
        stored_name=attachment.stored_name,
        original_name=attachment.original_name,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        uploaded_at=attachment.uploaded_at,
        download_url=f"/attachments/{attachment.id}/download",
    )



def parse_json_value(raw: str | None, fallback: Any):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def category_to_payload(item: Category) -> dict[str, Any]:
    return {
        "id": item.id,
        "title": item.title,
        "modules": parse_json_value(item.modules_json, []),
        "content": item.content,
        "table_data": parse_json_value(item.table_json, {"columns": [], "rows": []}),
        "nocodb": {
            "table_id": item.nocodb_table_id,
            "table_name": item.nocodb_table_name,
            "available_columns": parse_json_value(getattr(item, 'nocodb_available_columns_json', None), []),
            "filters": parse_json_value(item.nocodb_filters_json, []),
            "visible_columns": parse_json_value(item.nocodb_visible_columns_json, []),
        },
    }


def apply_category_payload(category_model: Category, payload: Any) -> None:
    table_data = getattr(payload, "table_data", None)
    nocodb = getattr(payload, "nocodb", None)
    modules = list(getattr(payload, "modules", []) or [])
    category_model.title = payload.title
    category_model.content = payload.content if "description" in modules else ""
    category_model.modules_json = json.dumps(modules)
    category_model.table_json = json.dumps(table_data.model_dump() if table_data else {"columns": [], "rows": []})
    category_model.nocodb_table_id = getattr(nocodb, "table_id", None)
    category_model.nocodb_table_name = getattr(nocodb, "table_name", None)
    category_model.nocodb_filters_json = json.dumps([item.model_dump() for item in (getattr(nocodb, "filters", []) or [])])
    category_model.nocodb_available_columns_json = json.dumps(list(getattr(nocodb, "available_columns", []) or []))
    category_model.nocodb_visible_columns_json = json.dumps(list(getattr(nocodb, "visible_columns", []) or []))


def replace_categories_from_payload(location: Location, categories: list[Any]) -> None:
    location.categories.clear()
    for category in categories:
        model = Category()
        apply_category_payload(model, category)
        location.categories.append(model)


def sync_categories_from_payload(location: Location, categories: list[CategoryUpdate], db: Session) -> None:
    existing_by_id = {item.id: item for item in location.categories}
    keep_ids = {item.id for item in categories if getattr(item, "id", None) in existing_by_id}

    for existing in list(location.categories):
        if existing.id not in keep_ids:
            db.delete(existing)

    updated_categories: list[Category] = []
    for category in categories:
        category_id = getattr(category, "id", None)
        model = existing_by_id.get(category_id) if category_id is not None else None
        if model is None:
            model = Category(location=location)
        apply_category_payload(model, category)
        updated_categories.append(model)

    location.categories = updated_categories


def nocodb_headers() -> dict[str, str]:
    if not NOCODB_BASE_URL or not NOCODB_API_TOKEN:
        raise HTTPException(status_code=400, detail="Configura NocoDB nel backend prima di usare questa funzione")
    return {"xc-token": NOCODB_API_TOKEN}


def nocodb_request(method: str, path: str, *, params: dict[str, Any] | None = None) -> Any:
    url = f"{NOCODB_BASE_URL}{path}"
    try:
        with httpx.Client(timeout=20.0, headers=nocodb_headers()) as client:
            response = client.request(method, url, params=params)
            response.raise_for_status()
            return response.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        raise HTTPException(status_code=502, detail=f"Errore NocoDB: {detail}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Connessione a NocoDB fallita: {exc}") from exc


def build_nocodb_where(filters: list[Any]) -> str | None:
    parts = []
    for item in filters:
        field = str(getattr(item, "field", "")).strip()
        op = str(getattr(item, "op", "eq")).strip() or "eq"
        value = str(getattr(item, "value", "")).strip()
        if not field or value == "":
            continue
        if op not in ALLOWED_NOCODB_OPERATORS:
            op = "eq"
        safe_field = field.replace('"', '\"')
        safe_value = value.replace('"', '\"')
        parts.append(f'({safe_field},{op},"{safe_value}")')
    if not parts:
        return None
    return '~and'.join(parts)





def extract_nocodb_columns(payload: Any) -> list[str]:
    source = None
    if isinstance(payload, dict):
        for key in ("columns", "list", "fields", "children"):
            value = payload.get(key)
            if isinstance(value, list):
                source = value
                break
    elif isinstance(payload, list):
        source = payload

    if not source:
        return []

    columns: list[str] = []
    skip = {"Id", "CreatedAt", "UpdatedAt", "id", "fields", "records", "next", "nestedNext", "pageInfo"}
    for item in source:
        name = None
        if isinstance(item, str):
            name = item
        elif isinstance(item, dict):
            name = item.get("title") or item.get("column_name") or item.get("columnName") or item.get("name")
        if not name or name in skip:
            continue
        s = str(name)
        if s not in columns:
            columns.append(s)
    return columns


def extract_nocodb_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("list", "rows", "data", "records"):
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        page_info = payload.get("pageInfo")
        if isinstance(page_info, dict):
            nested = page_info.get("data")
            if isinstance(nested, list):
                return [row for row in nested if isinstance(row, dict)]
        wrapper_keys = {"records", "list", "rows", "data", "next", "nestedNext", "pageInfo", "page", "pageSize", "totalRows"}
        if payload and not (set(payload.keys()) & wrapper_keys):
            if all(isinstance(v, (str, int, float, bool, type(None), list, dict)) for v in payload.values()):
                if any(not isinstance(v, (list, dict)) for v in payload.values()) or isinstance(payload.get("fields"), dict):
                    return [payload]
    elif isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def extract_columns_from_rows(rows: list[dict[str, Any]]) -> list[str]:
    columns: list[str] = []
    skip = {"Id", "CreatedAt", "UpdatedAt", "id", "fields", "records", "next", "nestedNext", "pageInfo"}
    for row in rows:
        if not isinstance(row, dict):
            continue
        if isinstance(row.get("fields"), dict):
            for key in row["fields"].keys():
                if key not in skip and key not in columns:
                    columns.append(key)
            continue
        for key in row.keys():
            if key not in skip and key not in columns:
                columns.append(key)
    return columns


def normalize_nocodb_row(row: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    if isinstance(row.get("fields"), dict):
        return row["fields"]
    skip = {"id", "records", "next", "nestedNext", "pageInfo"}
    return {k: v for k, v in row.items() if k not in skip}


def delete_file_if_exists(filename: str | None) -> None:
    if not filename:
        return
    path = UPLOAD_DIR / filename
    if path.exists():
        path.unlink()


def save_upload_to_disk(file: UploadFile) -> tuple[str, str, int, str | None]:
    raw_name = file.filename or "upload.bin"
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", raw_name)
    stored_name = f"{uuid4().hex}_{safe_name}"
    destination = UPLOAD_DIR / stored_name
    size = 0
    with destination.open("wb") as output:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            output.write(chunk)
    return stored_name, raw_name, size, file.content_type

def hydrate_location(location_id: int, db: Session) -> Location:
    result = db.execute(
        select(Location)
        .options(selectinload(Location.categories), selectinload(Location.attachments))
        .where(Location.id == location_id)
    )
    location = result.scalars().unique().first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    return location


def to_location_read(location: Location) -> LocationRead:
    return LocationRead(
        id=location.id,
        name=location.name,
        description=location.description,
        latitude=location.latitude,
        longitude=location.longitude,
        marker_color=location.marker_color,
        marker_icon=location.marker_icon,
        image_url=build_location_image_url(location),
        image_original_name=location.image_original_name,
        categories=[category_to_payload(item) for item in location.categories],
        attachments=[attachment_to_read(item) for item in location.attachments],
        created_at=location.created_at,
        updated_at=location.updated_at,
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.username == payload.username)).scalars().first()
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    token = create_access_token(user.username)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user))


@app.get("/auth/me", response_model=UserRead)
def auth_me(current_user: User = Depends(get_current_user)):
    return UserRead.model_validate(current_user)


@app.get("/stats", response_model=StatsRead)
def get_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return StatsRead(
        locations=db.scalar(select(func.count(Location.id))) or 0,
        attachments=db.scalar(select(func.count(Attachment.id))) or 0,
        users=db.scalar(select(func.count(User.id))) or 0,
        categories=db.scalar(select(func.count(Category.id))) or 0,
    )


@app.post("/locations/{location_id}/image", response_model=LocationRead)
async def upload_location_image(
    location_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Carica un file immagine valido")
    old_name = location.image_stored_name
    stored_name, raw_name, _size, _content_type = save_upload_to_disk(file)
    await file.close()
    location.image_stored_name = stored_name
    location.image_original_name = raw_name
    location.updated_at = datetime.utcnow()
    db.commit()
    delete_file_if_exists(old_name)
    return to_location_read(hydrate_location(location_id, db))


@app.get("/locations/{location_id}/image")
def get_location_image(
    location_id: int,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = token
    _ = current_user
    location = db.get(Location, location_id)
    if not location or not location.image_stored_name:
        raise HTTPException(status_code=404, detail="Image not found")
    image_path = UPLOAD_DIR / location.image_stored_name
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image file missing")
    return FileResponse(image_path, media_type="application/octet-stream", filename=location.image_original_name or location.image_stored_name)


@app.delete("/locations/{location_id}/image", response_model=LocationRead)
def delete_location_image(
    location_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    old_name = location.image_stored_name
    location.image_stored_name = None
    location.image_original_name = None
    location.updated_at = datetime.utcnow()
    db.commit()
    delete_file_if_exists(old_name)
    return to_location_read(hydrate_location(location_id, db))


@app.get("/locations", response_model=list[LocationRead])
def list_locations(
    query: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Location).options(selectinload(Location.categories), selectinload(Location.attachments)).order_by(Location.id.desc())
    if query and query.strip():
        pattern = f"%{query.strip()}%"
        stmt = stmt.where((Location.name.ilike(pattern)) | (Location.description.ilike(pattern)))
    result = db.execute(stmt)
    return [to_location_read(item) for item in result.scalars().unique().all()]


@app.get("/locations/{location_id}", response_model=LocationRead)
def get_location(location_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return to_location_read(hydrate_location(location_id, db))


@app.post("/locations", response_model=LocationRead, status_code=201)
def create_location(payload: LocationCreate, db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "editor"))):
    location = Location(
        name=payload.name,
        description=payload.description,
        latitude=payload.latitude,
        longitude=payload.longitude,
        marker_color=payload.marker_color,
        marker_icon=payload.marker_icon,
    )
    replace_categories_from_payload(location, payload.categories)

    db.add(location)
    db.commit()
    db.refresh(location)
    return to_location_read(hydrate_location(location.id, db))


@app.put("/locations/{location_id}", response_model=LocationRead)
def update_location(location_id: int, payload: LocationUpdate, db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "editor"))):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    location.name = payload.name
    location.description = payload.description
    location.latitude = payload.latitude
    location.longitude = payload.longitude
    location.marker_color = payload.marker_color
    location.marker_icon = payload.marker_icon
    location.updated_at = datetime.utcnow()

    sync_categories_from_payload(location, payload.categories, db)

    db.commit()
    return to_location_read(hydrate_location(location_id, db))


@app.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "editor"))):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    image_name = location.image_stored_name
    for attachment in list(location.attachments):
        delete_file_if_exists(attachment.stored_name)
    db.delete(location)
    db.commit()
    delete_file_if_exists(image_name)
    return None


@app.get("/users", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    result = db.execute(select(User).order_by(User.role, User.username))
    return [UserRead.model_validate(item) for item in result.scalars().all()]


@app.post("/users", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    role = normalize_role(payload.role)
    if role not in ROLE_OPTIONS:
        raise HTTPException(status_code=400, detail="Invalid role")
    existing = db.execute(select(User).where((User.username == payload.username) | (User.email == payload.email))).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")
    user = User(
        username=payload.username,
        email=payload.email,
        role=role,
        is_active=payload.is_active,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


@app.put("/users/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role = normalize_role(payload.role)
    if role not in ROLE_OPTIONS:
        raise HTTPException(status_code=400, detail="Invalid role")
    duplicate = db.execute(
        select(User).where(((User.username == payload.username) | (User.email == payload.email)) & (User.id != user_id))
    ).scalars().first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Username or email already used")
    user.username = payload.username
    user.email = payload.email
    user.role = role
    user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


@app.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_roles("admin"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare il tuo account")
    db.delete(user)
    db.commit()
    return None


@app.get("/attachments", response_model=list[AttachmentRead])
def list_attachments(
    location_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(Attachment).order_by(Attachment.id.desc())
    if location_id:
        stmt = stmt.where(Attachment.location_id == location_id)
    result = db.execute(stmt)
    return [attachment_to_read(item) for item in result.scalars().all()]


@app.post("/attachments", response_model=AttachmentRead, status_code=201)
async def upload_attachment(
    file: UploadFile = File(...),
    location_id: int = Form(...),
    category_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "editor")),
):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    if category_id:
        category = db.get(Category, category_id)
        if not category or category.location_id != location_id:
            raise HTTPException(status_code=400, detail="Category not valid for location")
    stored_name, raw_name, size, content_type = save_upload_to_disk(file)
    await file.close()

    attachment = Attachment(
        location_id=location_id,
        category_id=category_id,
        stored_name=stored_name,
        original_name=raw_name,
        content_type=content_type,
        size_bytes=size,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment_to_read(attachment)


@app.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    attachment = db.get(Attachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = UPLOAD_DIR / attachment.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")
    return FileResponse(path, media_type=attachment.content_type or "application/octet-stream", filename=attachment.original_name)


@app.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles("admin", "editor"))):
    attachment = db.get(Attachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = UPLOAD_DIR / attachment.stored_name
    if path.exists():
        path.unlink()
    db.delete(attachment)
    db.commit()
    return None


@app.get("/nocodb/tables", response_model=list[NocoTableRead])
def list_nocodb_tables(_: User = Depends(get_current_user)):
    if not NOCODB_BASE_ID:
        raise HTTPException(status_code=400, detail="Configura NOCODB_BASE_ID nel backend")
    payload = nocodb_request("GET", f"/api/v3/meta/bases/{NOCODB_BASE_ID}/tables")
    rows = payload.get("list") if isinstance(payload, dict) else payload
    rows = rows or []
    tables = []
    for item in rows:
        if not item.get("id"):
            continue
        table_id = str(item.get("id"))
        tables.append(NocoTableRead(
            id=table_id,
            title=item.get("title") or item.get("table_name") or table_id,
            columns=[],
        ))
    return tables


@app.get("/nocodb/tables/{table_id}/columns")
def get_nocodb_columns(table_id: str, _: User = Depends(get_current_user)):
    if not NOCODB_BASE_ID:
        raise HTTPException(status_code=400, detail="Configura NOCODB_BASE_ID nel backend")

    try:
        payload = nocodb_request("GET", f"/api/v3/meta/tables/{table_id}/columns")
        columns = extract_nocodb_columns(payload)
        if columns:
            return {"columns": columns}
    except HTTPException:
        pass

    try:
        tables_payload = nocodb_request("GET", f"/api/v3/meta/bases/{NOCODB_BASE_ID}/tables")
        table_rows = tables_payload.get("list") if isinstance(tables_payload, dict) else tables_payload
        table_rows = table_rows or []
        selected = next((item for item in table_rows if str(item.get("id")) == str(table_id)), None)
        columns = extract_nocodb_columns(selected or {})
        if columns:
            return {"columns": columns}
    except HTTPException:
        pass

    rows_payload = nocodb_request("GET", f"/api/v3/data/{NOCODB_BASE_ID}/{table_id}/records", params={"pageSize": 10})
    rows = extract_nocodb_rows(rows_payload)
    if not rows:
        return {"columns": []}
    return {"columns": extract_columns_from_rows(rows)}


@app.post("/nocodb/tables/{table_id}/rows", response_model=NocoRowsResponse)
def query_nocodb_rows(table_id: str, payload: NocoRowsRequest, _: User = Depends(get_current_user)):
    if not NOCODB_BASE_ID:
        raise HTTPException(status_code=400, detail="Configura NOCODB_BASE_ID nel backend")
    params: dict[str, Any] = {"pageSize": payload.limit}
    if payload.visible_columns:
        params["fields"] = ",".join(payload.visible_columns)
    where_clause = build_nocodb_where(payload.filters)
    if where_clause:
        params["where"] = where_clause
    rows_payload = nocodb_request("GET", f"/api/v3/data/{NOCODB_BASE_ID}/{table_id}/records", params=params)
    rows = extract_nocodb_rows(rows_payload)
    normalized_rows = [normalize_nocodb_row(row) for row in rows]
    normalized_rows = [row for row in normalized_rows if row]

    columns = list(payload.visible_columns)
    if not columns and normalized_rows:
        columns = extract_columns_from_rows(normalized_rows)

    trimmed = []
    for row in normalized_rows:
        if columns:
            trimmed.append({column: row.get(column) for column in columns})
        else:
            trimmed.append(row)
    return NocoRowsResponse(columns=columns, rows=trimmed)


@app.get("/export/json")
def export_json(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    locations = db.execute(select(Location).options(selectinload(Location.categories), selectinload(Location.attachments)).order_by(Location.id)).scalars().unique().all()
    users = db.execute(select(User).order_by(User.id)).scalars().all()
    payload = ExportPayload(
        locations=[to_location_read(item) for item in locations],
        users=[UserRead.model_validate(item) for item in users],
        exported_at=datetime.utcnow(),
    )
    return JSONResponse(content=json.loads(payload.model_dump_json()))


@app.post("/import/json")
async def import_json(file: UploadFile = File(...), db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    raw = await file.read()
    await file.close()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    imported_locations = 0
    imported_users = 0

    for item in payload.get("users", []):
        username = item.get("username")
        email = item.get("email")
        role = normalize_role(item.get("role", "viewer"))
        if not username or not email:
            continue
        if role not in ROLE_OPTIONS:
            role = "viewer"
        existing = db.execute(select(User).where((User.username == username) | (User.email == email))).scalars().first()
        if existing:
            existing.email = email
            existing.role = role
            existing.is_active = item.get("is_active", True)
        else:
            db.add(User(username=username, email=email, role=role, is_active=item.get("is_active", True), password_hash=hash_password(DEFAULT_PASSWORDS.get(role, "changeme123"))))
            imported_users += 1

    for item in payload.get("locations", []):
        location = Location(
            name=item.get("name", "Nuovo punto"),
            description=item.get("description"),
            latitude=item.get("latitude", 0),
            longitude=item.get("longitude", 0),
            marker_color=item.get("marker_color", "#4f8cff"),
            marker_icon=item.get("marker_icon", "🏗️"),
        )
        for category in item.get("categories", []):
            title = category.get("title")
            if not title:
                continue
            location.categories.append(Category(
                title=title,
                content=category.get("content", ""),
                table_json=json.dumps(category.get("table_data") or {"columns": [], "rows": []}),
                nocodb_table_id=(category.get("nocodb") or {}).get("table_id"),
                nocodb_table_name=(category.get("nocodb") or {}).get("table_name"),
                nocodb_filters_json=json.dumps((category.get("nocodb") or {}).get("filters") or []),
                nocodb_available_columns_json=json.dumps((category.get("nocodb") or {}).get("available_columns") or []),
                nocodb_visible_columns_json=json.dumps((category.get("nocodb") or {}).get("visible_columns") or []),
            ))
        db.add(location)
        imported_locations += 1

    db.commit()
    return {"imported_locations": imported_locations, "imported_users": imported_users}
