CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'image', 'note')),
  filename TEXT,
  mime_type TEXT,
  r2_key TEXT,
  note_text TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_library_status_created ON library_items(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_title ON library_items(title);
