/**
 * InstallId — a thin, anonymous, randomly-generated per-install identifier,
 * persisted in localStorage. Exists purely to let logged ground-truth
 * observations (src/dev/observationLogger.js) be correlated back to "the
 * same physical device/install," e.g. checking whether one tester's own
 * contrail-spotting rate or angular-size judgement differs systematically
 * from another's — a real gap flagged during the telemetry-catalogue
 * review that led to the relay request-ledger work (see CLAUDE.md): every
 * observation already records what was seen and what the model predicted,
 * but nothing tied multiple observations together as "from the same
 * tester," so any per-tester pattern was invisible in the aggregate data.
 *
 * Deliberately NOT a user identity of any kind — generated locally, never
 * tied to an account, email, or any other real-world identifier, and never
 * sent anywhere except attached to this device's own logged observations.
 * A tester who clears site data, reinstalls, or switches devices simply
 * gets a new one; nothing in this app tracks or needs the two linked.
 */
const InstallId = (() => {
  const STORAGE_KEY = "vcas-install-id";

  function _generate() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback for older browsers without crypto.randomUUID() — doesn't
    // need to be cryptographically strong, this is an opaque correlation
    // key, not a security token.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** Returns this install's persisted ID, generating and storing one on
   * first call. Never throws — a localStorage failure (private browsing,
   * quota, disabled storage) degrades to a fresh one-off ID for that one
   * call rather than blocking an observation from being logged at all. */
  function get() {
    try {
      let id = localStorage.getItem(STORAGE_KEY);
      if (!id) {
        id = _generate();
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch (e) {
      return _generate();
    }
  }

  return { get };
})();

if (typeof module !== "undefined") module.exports = InstallId;
