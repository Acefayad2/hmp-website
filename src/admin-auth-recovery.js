export function createAdminAuthRecovery({getUser, ensureVerification, showLogin, onStart = () => {}}) {
  let pending = null;
  return function requireAdminAuthentication() {
    if (pending) return pending;
    onStart();
    pending = Promise.resolve()
      .then(getUser)
      .then(user => user ? ensureVerification(user) : showLogin())
      .catch(error => showLogin(error))
      .finally(() => { pending = null; });
    return pending;
  };
}
