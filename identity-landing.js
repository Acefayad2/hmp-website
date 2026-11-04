// Identity emails can land on the public homepage. Keep credentials in the
// fragment and hand them to the existing Admin callback handler.
(() => {
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.slice(1));
  if (["recovery_token", "invite_token"].some((key) => params.get(key)?.trim())) {
    window.location.replace("/admin" + hash);
  }
})();
