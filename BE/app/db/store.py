from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable

import numpy as np

from app.config import Settings, get_settings
from app.schemas import Filter
from app.services.filters import row_matches

CONTAINERS: dict[str, str] = {
    "sources": "/id",
    "rows": "/source_id",
    "chunks": "/source_id",
    "conversations": "/id",
    "meta": "/id",
    "dashboards": "/id",
}
SYSTEM_KEYS = {"_rid", "_self", "_etag", "_attachments", "_ts"}

ProgressCb = Callable[[int, int], Awaitable[None]]


def clean(doc: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k not in SYSTEM_KEYS}


class Store(ABC):
    backend: str = "abstract"

    async def init(self) -> None: ...
    async def close(self) -> None: ...

    @abstractmethod
    async def upsert(self, container: str, doc: dict[str, Any]) -> None: ...
    @abstractmethod
    async def get(self, container: str, doc_id: str) -> dict[str, Any] | None: ...
    @abstractmethod
    async def delete(self, container: str, doc_id: str) -> None: ...
    @abstractmethod
    async def list_all(self, container: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def insert_rows(
        self, source_id: str, rows: list[dict[str, Any]], progress: ProgressCb | None = None
    ) -> None: ...
    @abstractmethod
    async def fetch_rows(
        self, source_id: str, filters: list[Filter], limit: int | None = None
    ) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def insert_chunks(self, source_id: str, chunks: list[dict[str, Any]]) -> None: ...
    @abstractmethod
    async def vector_search(
        self, embedding: list[float], top_k: int, source_ids: list[str] | None
    ) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def delete_source_data(self, source_id: str) -> None: ...


class MemoryStore(Store):
    backend = "memory"

    def __init__(self) -> None:
        self.docs: dict[str, dict[str, dict[str, Any]]] = {c: {} for c in CONTAINERS}
        self.rows: dict[str, list[dict[str, Any]]] = {}
        self.chunks: dict[str, list[dict[str, Any]]] = {}

    async def upsert(self, container, doc):
        self.docs[container][doc["id"]] = dict(doc)

    async def get(self, container, doc_id):
        d = self.docs[container].get(doc_id)
        return dict(d) if d else None

    async def delete(self, container, doc_id):
        self.docs[container].pop(doc_id, None)

    async def list_all(self, container):
        return [dict(d) for d in self.docs[container].values()]

    async def insert_rows(self, source_id, rows, progress=None):
        self.rows.setdefault(source_id, []).extend(rows)
        if progress:
            await progress(len(rows), len(rows))

    async def fetch_rows(self, source_id, filters, limit=None):
        out = []
        for r in self.rows.get(source_id, []):
            if row_matches(r, filters):
                out.append(r)
                if limit and len(out) >= limit:
                    break
        return out

    async def insert_chunks(self, source_id, chunks):
        self.chunks.setdefault(source_id, []).extend(chunks)

    async def vector_search(self, embedding, top_k, source_ids):
        return _brute_force(
            [c for sid, cs in self.chunks.items() if not source_ids or sid in source_ids for c in cs],
            embedding,
            top_k,
        )

    async def delete_source_data(self, source_id):
        self.rows.pop(source_id, None)
        self.chunks.pop(source_id, None)


def _brute_force(chunks: list[dict[str, Any]], embedding: list[float], top_k: int) -> list[dict[str, Any]]:
    if not chunks:
        return []
    mat = np.asarray([c["embedding"] for c in chunks], dtype=np.float32)
    q = np.asarray(embedding, dtype=np.float32)
    sims = (mat @ q) / (np.linalg.norm(mat, axis=1) * np.linalg.norm(q) + 1e-9)
    order = np.argsort(-sims)[:top_k]
    return [{**{k: v for k, v in chunks[i].items() if k != "embedding"}, "score": float(sims[i])} for i in order]


async def _retry_throttled(fn, *args, attempts: int = 12, **kwargs):
    from azure.cosmos.exceptions import CosmosHttpResponseError

    delay = 0.5
    for attempt in range(attempts):
        try:
            return await fn(*args, **kwargs)
        except CosmosHttpResponseError as e:
            if e.status_code not in (429, 449, 503) or attempt == attempts - 1:
                raise
            hinted = float((getattr(e, "headers", None) or {}).get("x-ms-retry-after-ms", 0) or 0) / 1000
            await asyncio.sleep(max(hinted, delay))
            delay = min(delay * 2, 8.0)


class CosmosStore(Store):
    backend = "cosmos"

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.client = None
        self.db = None
        self.containers: dict[str, Any] = {}
        self._vector_ok = True
        self._chunk_cache: dict[str, list[dict[str, Any]]] = {}
        self._rows_cache: dict[str, list[dict[str, Any]]] = {}
        self._rows_locks: dict[str, asyncio.Lock] = {}

    async def init(self) -> None:
        from azure.cosmos import PartitionKey
        from azure.cosmos.aio import CosmosClient

        self.client = CosmosClient(
            self.s.cosmos_endpoint,
            credential=self.s.cosmos_key,
            connection_verify=self.s.cosmos_verify_ssl,
        )
        self.db = await self.client.create_database_if_not_exists(id=self.s.cosmos_database)
        for name, pk in CONTAINERS.items():
            key = PartitionKey(path=pk)
            if name == "chunks":
                self.containers[name] = await self._init_chunks(key)
            else:
                self.containers[name] = await self.db.create_container_if_not_exists(id=name, partition_key=key)

    async def _init_chunks(self, key):
        index = {
            "indexingMode": "consistent",
            "automatic": True,
            "includedPaths": [{"path": "/*"}],
            "excludedPaths": [{"path": '/"_etag"/?'}, {"path": "/embedding/*"}],
        }
        try:
            container = await self.db.create_container_if_not_exists(
                id="chunks",
                partition_key=key,
                vector_embedding_policy={
                    "vectorEmbeddings": [
                        {
                            "path": "/embedding",
                            "dataType": "float32",
                            "distanceFunction": "cosine",
                            "dimensions": self.s.embedding_dimensions,
                        }
                    ]
                },
                indexing_policy={**index, "vectorIndexes": [{"path": "/embedding", "type": "quantizedFlat"}]},
            )
        except Exception:
            container = await self.db.create_container_if_not_exists(
                id="chunks", partition_key=key, indexing_policy=index
            )
        props = await container.read()
        self._vector_ok = "vectorEmbeddingPolicy" in props
        excluded = {p["path"] for p in props.get("indexingPolicy", {}).get("excludedPaths", [])}
        if not self._vector_ok and "/embedding/*" not in excluded:
            await self.db.replace_container(container, key, indexing_policy=index)
        return container

    async def close(self) -> None:
        if self.client:
            await self.client.close()

    async def upsert(self, container, doc):
        await self.containers[container].upsert_item(doc)

    async def get(self, container, doc_id):
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        try:
            return clean(await self.containers[container].read_item(item=doc_id, partition_key=doc_id))
        except CosmosResourceNotFoundError:
            return None

    async def delete(self, container, doc_id):
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        try:
            await self.containers[container].delete_item(item=doc_id, partition_key=doc_id)
        except CosmosResourceNotFoundError:
            pass

    async def list_all(self, container):
        return [clean(d) async for d in self.containers[container].query_items("SELECT * FROM c")]

    async def insert_rows(self, source_id, rows, progress=None):
        container = self.containers["rows"]
        sem = asyncio.Semaphore(self.s.cosmos_write_concurrency)
        done = 0
        total = len(rows)

        async def put(i: int, data: dict[str, Any]) -> None:
            nonlocal done
            async with sem:
                await _retry_throttled(
                    container.upsert_item, {"id": f"{source_id}:{i}", "source_id": source_id, "i": i, "d": data}
                )
            done += 1
            if progress and (done % 250 == 0 or done == total):
                await progress(done, total)

        await asyncio.gather(*(put(i, r) for i, r in enumerate(rows)))
        self._rows_cache.pop(source_id, None)

    async def _all_rows(self, source_id: str) -> list[dict[str, Any]]:
        if source_id not in self._rows_cache:
            lock = self._rows_locks.setdefault(source_id, asyncio.Lock())
            async with lock:
                if source_id not in self._rows_cache:
                    self._rows_cache[source_id] = [
                        r
                        async for r in self.containers["rows"].query_items(
                            "SELECT VALUE c.d FROM c ORDER BY c.i", partition_key=source_id
                        )
                    ]
        return self._rows_cache[source_id]

    async def fetch_rows(self, source_id, filters, limit=None):
        rows = await self._all_rows(source_id)
        if filters:
            rows = [r for r in rows if row_matches(r, filters)]
        return rows[:limit] if limit else rows

    async def insert_chunks(self, source_id, chunks):
        container = self.containers["chunks"]
        sem = asyncio.Semaphore(self.s.cosmos_write_concurrency)

        async def put(c: dict[str, Any]) -> None:
            async with sem:
                await _retry_throttled(container.upsert_item, {**c, "source_id": source_id})

        await asyncio.gather(*(put(c) for c in chunks))
        self._chunk_cache.pop(source_id, None)

    async def _cached_chunks(self, source_ids: list[str] | None) -> list[dict[str, Any]]:
        container = self.containers["chunks"]
        ids = source_ids or [
            i async for i in container.query_items("SELECT DISTINCT VALUE c.source_id FROM c")
        ]
        out: list[dict[str, Any]] = []
        for sid in ids:
            if sid not in self._chunk_cache:
                self._chunk_cache[sid] = [
                    c async for c in container.query_items("SELECT * FROM c", partition_key=sid)
                ]
            out += self._chunk_cache[sid]
        return out

    async def vector_search(self, embedding, top_k, source_ids):
        container = self.containers["chunks"]
        if self._vector_ok:
            where = "WHERE ARRAY_CONTAINS(@sids, c.source_id) " if source_ids else ""
            sql = (
                f"SELECT TOP {int(top_k)} c.id, c.source_id, c.chunk_index, c.page, c.text, "
                "VectorDistance(c.embedding, @e) AS score FROM c "
                f"{where}ORDER BY VectorDistance(c.embedding, @e)"
            )
            params = [{"name": "@e", "value": embedding}]
            if source_ids:
                params.append({"name": "@sids", "value": source_ids})
            try:
                return [r async for r in container.query_items(query=sql, parameters=params)]
            except Exception:
                self._vector_ok = False
        return _brute_force(await self._cached_chunks(source_ids), embedding, top_k)

    async def delete_source_data(self, source_id):
        self._chunk_cache.pop(source_id, None)
        self._rows_cache.pop(source_id, None)
        for name in ("rows", "chunks"):
            container = self.containers[name]
            ids = [i async for i in container.query_items("SELECT VALUE c.id FROM c", partition_key=source_id)]
            sem = asyncio.Semaphore(self.s.cosmos_write_concurrency)

            async def rm(item_id: str) -> None:
                async with sem:
                    await _retry_throttled(container.delete_item, item=item_id, partition_key=source_id)

            await asyncio.gather(*(rm(i) for i in ids))


_store: Store | None = None


async def get_store() -> Store:
    global _store
    if _store is None:
        s = get_settings()
        store: Store = CosmosStore(s) if s.use_cosmos else MemoryStore()
        await store.init()
        _store = store
    return _store


async def close_store() -> None:
    global _store
    if _store is not None:
        await _store.close()
        _store = None
