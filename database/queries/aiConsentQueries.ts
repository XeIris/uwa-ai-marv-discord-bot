const aiConsentQueries = {
  // Upsert: a user re-accepting after a version bump overwrites their old row
  // rather than accumulating one row per version. The audit trail we care about
  // is "did this user accept the version currently in force", not their history.
  RECORD: `
    INSERT INTO AiConsent (user_id, policy_version, accepted_at)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id)
    DO UPDATE SET policy_version = excluded.policy_version, accepted_at = excluded.accepted_at
  `,
  GET: 'SELECT * FROM AiConsent WHERE user_id = ?',
  REVOKE: 'DELETE FROM AiConsent WHERE user_id = ?',
};

export default aiConsentQueries;
