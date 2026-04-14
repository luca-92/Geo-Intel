from datetime import datetime
from pydantic import BaseModel, Field


class NocoFilterDefinition(BaseModel):
    field: str = Field(..., min_length=1, max_length=120)
    op: str = Field(default="eq", min_length=1, max_length=16)
    value: str = Field(default="")


class NocoSelection(BaseModel):
    table_id: str | None = None
    table_name: str | None = None
    available_columns: list[str] = Field(default_factory=list)
    visible_columns: list[str] = Field(default_factory=list)
    filters: list[NocoFilterDefinition] = Field(default_factory=list)


class CategoryTableData(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, str]] = Field(default_factory=list)


class CategoryBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    modules: list[str] = Field(default_factory=list)
    content: str = Field(default="")
    table_data: CategoryTableData = Field(default_factory=CategoryTableData)
    nocodb: NocoSelection = Field(default_factory=NocoSelection)


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(CategoryBase):
    id: int | None = None


class CategoryRead(CategoryBase):
    id: int

    model_config = {"from_attributes": True}


class AttachmentRead(BaseModel):
    id: int
    location_id: int
    category_id: int | None = None
    stored_name: str
    original_name: str
    content_type: str | None = None
    size_bytes: int
    uploaded_at: datetime
    download_url: str

    model_config = {"from_attributes": True}


class LocationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    marker_color: str = Field(default="#4f8cff", min_length=4, max_length=32)
    marker_icon: str = Field(default="🏗️", min_length=1, max_length=32)


class LocationCreate(LocationBase):
    categories: list[CategoryCreate] = Field(default_factory=list)


class LocationUpdate(LocationBase):
    categories: list[CategoryUpdate] = Field(default_factory=list)


class LocationRead(LocationBase):
    id: int
    image_url: str | None = None
    image_original_name: str | None = None
    categories: list[CategoryRead] = Field(default_factory=list)
    attachments: list[AttachmentRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class NocoTableRead(BaseModel):
    id: str
    title: str
    columns: list[str] = Field(default_factory=list)


class NocoRowsRequest(BaseModel):
    visible_columns: list[str] = Field(default_factory=list)
    filters: list[NocoFilterDefinition] = Field(default_factory=list)
    limit: int = Field(default=25, ge=1, le=200)


class NocoRowsResponse(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[dict] = Field(default_factory=list)


class UserBase(BaseModel):
    username: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=3, max_length=255)
    role: str = Field(default="viewer", min_length=1, max_length=50)
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)


class UserUpdate(BaseModel):
    username: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=3, max_length=255)
    role: str = Field(default="viewer", min_length=1, max_length=50)
    is_active: bool = True
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserRead(UserBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=120)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class StatsRead(BaseModel):
    locations: int
    attachments: int
    users: int
    categories: int


class ExportPayload(BaseModel):
    locations: list[LocationRead]
    users: list[UserRead]
    exported_at: datetime
