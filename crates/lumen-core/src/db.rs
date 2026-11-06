//! SQLite store for application data. Stores *references* to user files, never
//! copies of them.

use crate::error::Result;
use crate::metadata::Probe;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

/// Ordered migrations; index + 1 == schema version (PRAGMA user_version).
const MIGRATIONS: &[&str] = &[
    // v1
    r#"
    CREATE TABLE folders (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE image_metadata (
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        captured_at INTEGER,
        animated INTEGER NOT NULL DEFAULT 0,
        content_id TEXT,
        probed_at INTEGER NOT NULL
    );
    CREATE TABLE favorites (
        path TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE collections (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE collection_items (
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (collection_id, path)
    );
    CREATE TABLE recent_files (
        path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
        opened_at INTEGER NOT NULL,
        PRIMARY KEY (path, kind)
    );
    CREATE INDEX recent_by_time ON recent_files(kind, opened_at DESC);
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE thumbnail_cache_index (
        key TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_access INTEGER NOT NULL
    );
    CREATE INDEX thumb_by_access ON thumbnail_cache_index(last_access);
    CREATE TABLE edit_history (
        path TEXT PRIMARY KEY,
        params TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    "#,
];

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub count: i64,
    pub cover: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub kind: String,
    pub opened_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub name: String,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")?;
        let db = Db { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    pub fn schema_version(&self) -> Result<i64> {
        Ok(self.conn.lock().query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    fn migrate(&self) -> Result<()> {
        let mut conn = self.conn.lock();
        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
            log::info!("database migrated to v{}", i + 1);
        }
        Ok(())
    }

    // ---------- settings ----------
    pub fn settings(&self) -> Result<serde_json::Map<String, serde_json::Value>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare("SELECT key, value FROM settings")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = serde_json::Map::new();
        for row in rows {
            let (k, v) = row?;
            if let Ok(v) = serde_json::from_str(&v) {
                map.insert(k, v);
            }
        }
        Ok(map)
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value.to_string()],
        )?;
        Ok(())
    }

    // ---------- favorites ----------
    pub fn set_favorite(&self, path: &str, fav: bool) -> Result<()> {
        let conn = self.conn.lock();
        if fav {
            conn.execute("INSERT OR IGNORE INTO favorites(path, added_at) VALUES (?1, ?2)", params![path, now_ms()])?;
        } else {
            conn.execute("DELETE FROM favorites WHERE path = ?1", params![path])?;
        }
        Ok(())
    }

    pub fn favorites(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare("SELECT path FROM favorites ORDER BY added_at DESC")?;
        let v = st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }

    // ---------- collections ----------
    pub fn create_collection(&self, name: &str) -> Result<i64> {
        let conn = self.conn.lock();
        conn.execute("INSERT INTO collections(name, created_at) VALUES (?1, ?2)", params![name.trim(), now_ms()])?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename_collection(&self, id: i64, name: &str) -> Result<()> {
        self.conn.lock().execute("UPDATE collections SET name = ?2 WHERE id = ?1", params![id, name.trim()])?;
        Ok(())
    }

    pub fn delete_collection(&self, id: i64) -> Result<()> {
        self.conn.lock().execute("DELETE FROM collections WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn collections(&self) -> Result<Vec<Collection>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare(
            "SELECT c.id, c.name, c.created_at, COUNT(i.path),
                    (SELECT path FROM collection_items WHERE collection_id = c.id ORDER BY added_at DESC LIMIT 1)
             FROM collections c LEFT JOIN collection_items i ON i.collection_id = c.id
             GROUP BY c.id ORDER BY c.name COLLATE NOCASE",
        )?;
        let v = st
            .query_map([], |r| Ok(Collection { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?, count: r.get(3)?, cover: r.get(4)? }))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }

    pub fn add_to_collection(&self, id: i64, paths: &[String]) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let now = now_ms();
        for p in paths {
            tx.execute("INSERT OR IGNORE INTO collection_items(collection_id, path, added_at) VALUES (?1, ?2, ?3)", params![id, p, now])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_from_collection(&self, id: i64, paths: &[String]) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        for p in paths {
            tx.execute("DELETE FROM collection_items WHERE collection_id = ?1 AND path = ?2", params![id, p])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn collection_items(&self, id: i64) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare("SELECT path FROM collection_items WHERE collection_id = ?1 ORDER BY added_at")?;
        let v = st.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }

    // ---------- recents ----------
    pub fn add_recent(&self, path: &str, kind: &str) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO recent_files(path, kind, opened_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path, kind) DO UPDATE SET opened_at = excluded.opened_at",
            params![path, kind, now_ms()],
        )?;
        // Keep the history bounded.
        conn.execute(
            "DELETE FROM recent_files WHERE kind = ?1 AND path NOT IN
             (SELECT path FROM recent_files WHERE kind = ?1 ORDER BY opened_at DESC LIMIT 500)",
            params![kind],
        )?;
        Ok(())
    }

    pub fn recents(&self, kind: &str, limit: i64) -> Result<Vec<RecentEntry>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare("SELECT path, kind, opened_at FROM recent_files WHERE kind = ?1 ORDER BY opened_at DESC LIMIT ?2")?;
        let v = st
            .query_map(params![kind, limit], |r| Ok(RecentEntry { path: r.get(0)?, kind: r.get(1)?, opened_at: r.get(2)? }))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }

    pub fn clear_recents(&self) -> Result<()> {
        self.conn.lock().execute("DELETE FROM recent_files", [])?;
        Ok(())
    }

    // ---------- pinned folders ----------
    pub fn add_folder(&self, path: &str, name: &str) -> Result<()> {
        self.conn.lock().execute("INSERT OR IGNORE INTO folders(path, name, added_at) VALUES (?1, ?2, ?3)", params![path, name, now_ms()])?;
        Ok(())
    }

    pub fn remove_folder(&self, path: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM folders WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn folders(&self) -> Result<Vec<Folder>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare("SELECT id, path, name FROM folders ORDER BY added_at")?;
        let v = st.query_map([], |r| Ok(Folder { id: r.get(0)?, path: r.get(1)?, name: r.get(2)? }))?.collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }

    // ---------- metadata cache ----------
    pub fn cached_probe(&self, path: &str, size: u64, mtime: i64) -> Result<Option<Probe>> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row(
                "SELECT width, height, captured_at, animated, content_id FROM image_metadata WHERE path = ?1 AND size = ?2 AND mtime = ?3",
                params![path, size as i64, mtime],
                |r| Ok(Probe { width: r.get(0)?, height: r.get(1)?, captured: r.get(2)?, animated: r.get::<_, i64>(3)? != 0, content_id: r.get(4)? }),
            )
            .optional()?)
    }

    pub fn store_probes(&self, rows: &[(String, u64, i64, Probe)]) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let now = now_ms();
        {
            let mut st = tx.prepare(
                "INSERT INTO image_metadata(path, size, mtime, width, height, captured_at, animated, content_id, probed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, width=excluded.width, height=excluded.height,
                   captured_at=excluded.captured_at, animated=excluded.animated, content_id=excluded.content_id, probed_at=excluded.probed_at",
            )?;
            for (path, size, mtime, p) in rows {
                st.execute(params![path, *size as i64, mtime, p.width, p.height, p.captured, p.animated as i64, p.content_id, now])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    // ---------- thumbnail index ----------
    pub fn thumb_insert(&self, key: &str, path: &str, bytes: u64) -> Result<()> {
        let now = now_ms();
        self.conn.lock().execute(
            "INSERT OR REPLACE INTO thumbnail_cache_index(key, path, bytes, created_at, last_access) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![key, path, bytes as i64, now],
        )?;
        Ok(())
    }

    pub fn thumb_touch(&self, keys: &[String]) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let now = now_ms();
        for k in keys {
            tx.execute("UPDATE thumbnail_cache_index SET last_access = ?2 WHERE key = ?1", params![k, now])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn thumb_total_bytes(&self) -> Result<(u64, u64)> {
        let conn = self.conn.lock();
        Ok(conn.query_row("SELECT COALESCE(SUM(bytes), 0), COUNT(*) FROM thumbnail_cache_index", [], |r| {
            Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64))
        })?)
    }

    /// Least-recently-used entries, oldest first.
    pub fn thumb_lru(&self, limit: i64) -> Result<Vec<(String, u64)>> {
        let conn = self.conn.lock();
        let mut st = conn.prepare("SELECT key, bytes FROM thumbnail_cache_index ORDER BY last_access ASC LIMIT ?1")?;
        let v = st.query_map([limit], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64)))?.collect::<rusqlite::Result<_>>()?;
        Ok(v)
    }

    pub fn thumb_remove(&self, keys: &[String]) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        for k in keys {
            tx.execute("DELETE FROM thumbnail_cache_index WHERE key = ?1", [k])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn thumb_clear(&self) -> Result<()> {
        self.conn.lock().execute("DELETE FROM thumbnail_cache_index", [])?;
        Ok(())
    }

    // ---------- edits ----------
    pub fn edit_params(&self, path: &str) -> Result<Option<String>> {
        Ok(self.conn.lock().query_row("SELECT params FROM edit_history WHERE path = ?1", [path], |r| r.get(0)).optional()?)
    }

    pub fn save_edit_params(&self, path: &str, params_json: Option<&str>) -> Result<()> {
        let conn = self.conn.lock();
        match params_json {
            Some(p) => conn.execute(
                "INSERT INTO edit_history(path, params, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET params = excluded.params, updated_at = excluded.updated_at",
                params![path, p, now_ms()],
            )?,
            None => conn.execute("DELETE FROM edit_history WHERE path = ?1", [path])?,
        };
        Ok(())
    }

    /// Keep favourites, collections, edits and recents pointing at a file after
    /// it is renamed or moved inside the app.
    pub fn rename_path(&self, from: &str, to: &str) -> Result<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        for sql in [
            "UPDATE OR REPLACE favorites SET path = ?2 WHERE path = ?1",
            "UPDATE OR REPLACE collection_items SET path = ?2 WHERE path = ?1",
            "UPDATE OR REPLACE edit_history SET path = ?2 WHERE path = ?1",
            "UPDATE OR REPLACE recent_files SET path = ?2 WHERE path = ?1",
        ] {
            tx.execute(sql, params![from, to])?;
        }
        tx.execute("DELETE FROM image_metadata WHERE path = ?1", params![from])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_and_crud() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
        // Re-running migrate is a no-op.
        db.migrate().unwrap();

        db.set_favorite("/a.jpg", true).unwrap();
        db.set_favorite("/a.jpg", true).unwrap();
        assert_eq!(db.favorites().unwrap(), vec!["/a.jpg"]);

        let id = db.create_collection("Trip").unwrap();
        db.add_to_collection(id, &["/a.jpg".into(), "/b.jpg".into()]).unwrap();
        let c = &db.collections().unwrap()[0];
        assert_eq!((c.name.as_str(), c.count), ("Trip", 2));

        db.rename_path("/a.jpg", "/z.jpg").unwrap();
        assert_eq!(db.favorites().unwrap(), vec!["/z.jpg"]);
        assert!(db.collection_items(id).unwrap().contains(&"/z.jpg".to_string()));

        db.delete_collection(id).unwrap();
        assert!(db.collections().unwrap().is_empty());

        db.set_setting("theme", &serde_json::json!("dark")).unwrap();
        assert_eq!(db.settings().unwrap()["theme"], "dark");

        db.add_recent("/dir", "folder").unwrap();
        db.add_recent("/dir", "folder").unwrap();
        assert_eq!(db.recents("folder", 10).unwrap().len(), 1);

        let p = Probe { width: Some(10), height: Some(5), captured: Some(1), animated: true, content_id: None };
        db.store_probes(&[("/x.png".into(), 100, 7, p.clone())]).unwrap();
        assert_eq!(db.cached_probe("/x.png", 100, 7).unwrap(), Some(p));
        assert_eq!(db.cached_probe("/x.png", 100, 8).unwrap(), None);
    }
}
