-- Soul Blueprints table
CREATE TABLE IF NOT EXISTS soul_blueprints (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    birth_time TEXT NOT NULL,
    birth_city TEXT NOT NULL,
    birth_country TEXT NOT NULL,
    birth_lat REAL,
    birth_lon REAL,
    life_path INTEGER,
    sun_sign TEXT,
    moon_sign TEXT,
    rising_sign TEXT,
    chinese_animal TEXT,
    chinese_element TEXT,
    chinese_allies TEXT,
    chinese_enemies TEXT,
    planetary_ruler TEXT,
    alignment_numbers TEXT,
    name_gematria TEXT,
    nakshatra TEXT,
    human_design_type TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_soul_blueprints_user ON soul_blueprints(user_id);

-- Add flag to users table
ALTER TABLE users ADD COLUMN has_soul_blueprint INTEGER DEFAULT 0;
