CREATE TABLE auth_identities (
    id uuid PRIMARY KEY,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    email text,
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_firebase_identities (
    firebase_project_id text NOT NULL CHECK (char_length(firebase_project_id) BETWEEN 1 AND 128),
    firebase_uid text NOT NULL CHECK (char_length(firebase_uid) BETWEEN 1 AND 128),
    identity_id uuid NOT NULL REFERENCES auth_identities(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (firebase_project_id, firebase_uid)
);

CREATE INDEX auth_firebase_identities_identity_idx ON auth_firebase_identities(identity_id);
