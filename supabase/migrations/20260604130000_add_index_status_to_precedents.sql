-- Estado de indexación vectorial (embedding padre + precedent_chunks) por precedente.

ALTER TABLE precedents
ADD COLUMN index_status TEXT NOT NULL DEFAULT 'pending'
CHECK (index_status IN ('pending', 'ready', 'failed'));

UPDATE precedents SET index_status = 'ready' WHERE embedding IS NOT NULL;
