from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    marker_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#4f8cff")
    marker_icon: Mapped[str] = mapped_column(String(32), nullable=False, default="🏗️")
    image_stored_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    categories: Mapped[list["Category"]] = relationship(
        back_populates="location",
        cascade="all, delete-orphan",
        order_by="Category.id",
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="location",
        cascade="all, delete-orphan",
        order_by="Attachment.id.desc()",
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    modules_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    table_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    nocodb_table_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    nocodb_table_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nocodb_filters_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    nocodb_visible_columns_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    nocodb_available_columns_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"))

    location: Mapped[Location] = relationship(back_populates="categories")
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="category")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    location: Mapped[Location] = relationship(back_populates="attachments")
    category: Mapped[Category | None] = relationship(back_populates="attachments")
