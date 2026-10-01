// Shared seating sign-in is a convenience, not the CRM's authorization boundary.
// Every CRM endpoint still validates its own authenticated admin request.
export async function loadAdminWorkspace({ syncSharedSession, loadDashboard, loadMessages }) {
  const sharedSession = Promise.resolve().then(syncSharedSession).then(() => true, () => false);
  await Promise.all([loadDashboard(), loadMessages()]);
  return { sharedSessionReady: await sharedSession };
}
