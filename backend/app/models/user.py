from sqlalchemy import Column, String, Boolean
from sqlalchemy.dialects.postgresql import UUID
import uuid

from .base import Base, TimestampMixin

class User(Base, TimestampMixin):
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(String(50), default="nurse")
    ward_id = Column(String(50), default="ICU-1")
    is_active = Column(Boolean, default=True)

    def __repr__(self):
        return f"<User {self.email}>"
