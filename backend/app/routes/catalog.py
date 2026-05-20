"""Catalog list + per-table doc + audit endpoints.

Port of:
    src/app/api/catalog/route.ts
    src/app/api/doc/[tableId]/route.ts
    src/app/api/audit/route.ts
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.catalog.queries import (
    get_doc,
    list_tables_with_counts,
    recent_audit,
)

router = APIRouter()


@router.get("/")
async def list_catalog() -> dict[str, list[dict[str, Any]]]:
    tables = await list_tables_with_counts()
    return {
        "tables": [
            {
                "id": int(t["id"]),
                "schema": t["schema_name"],
                "name": t["table_name"],
                "row_count": int(t["row_count"] or 0),
                "column_count": int(t["column_count"] or 0),
                "status": t["status"],
                "profiled_at": t.get("last_profiled_at"),
                "enriched_at": t.get("last_enriched_at"),
                "source": t["source_name"],
            }
            for t in tables
        ]
    }


@router.get("/doc/{table_id}")
async def get_doc_route(table_id: int) -> dict[str, Any]:
    doc = await get_doc(table_id)
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return {
        "table_id": doc["table_id"],
        "markdown": doc["markdown"],
        "provenance": doc["provenance"],
        "updated_at": doc["updated_at"],
    }


@router.get("/audit")
async def audit_route(limit: int = 60) -> dict[str, list[dict[str, Any]]]:
    rows = await recent_audit(min(max(1, limit), 500))
    return {"entries": rows}
