// ===== Toast Notifications =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '&#10003;' : type === 'error' ? '&#10007;' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ===== Cart Badge =====
function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  const count = Cart.getCount();
  badge.textContent = count || '';
  badge.dataset.count = count;
}

// ===== Auth UI Update =====
function updateAuthUI() {
  const authBtn = document.getElementById('authBtn');
  const ordersLink = document.getElementById('ordersLink');
  const heroAuthBtn = document.getElementById('heroAuthBtn');

  if (Auth.isLoggedIn()) {
    const user = Auth.getUser();
    if (authBtn) {
      authBtn.textContent = user.name || 'Account';
      authBtn.href = '#';
      authBtn.onclick = (e) => {
        e.preventDefault();
        if (confirm('Sign out?')) {
          Auth.logout();
          window.location.reload();
        }
      };
      authBtn.classList.remove('btn', 'btn-primary', 'btn-sm');
    }
    if (ordersLink) ordersLink.style.display = '';
    if (heroAuthBtn) heroAuthBtn.style.display = 'none';
  } else {
    if (ordersLink) ordersLink.style.display = 'none';
  }
}

// ===== API Helper =====
async function apiFetch(url, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    Auth.logout();
    window.location.href = '/login.html';
    return null;
  }
  return res;
}
