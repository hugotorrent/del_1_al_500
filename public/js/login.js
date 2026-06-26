/* =====================
   LOGIN.JS
   ===================== */
(function () {
  'use strict';

  // Redirigir si ya hay sesión válida
  const token = localStorage.getItem('rifa_token');
  if (token) {
    window.location.replace('/rifa.html');
    return;
  }

  const form = document.getElementById('loginForm');
  const nombreInput = document.getElementById('nombre');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const errorMessage = document.getElementById('errorMessage');

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.add('show');
  }

  function hideError() {
    errorMessage.classList.remove('show');
  }

  function setLoading(loading) {
    loginBtn.disabled = loading;
    loginBtn.textContent = loading ? 'Ingresando...' : 'Ingresar al sistema';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const nombre = nombreInput.value.trim();
    const password = passwordInput.value;

    if (nombre.length < 2) {
      showError('Ingresá tu nombre (mínimo 2 caracteres)');
      nombreInput.focus();
      return;
    }

    if (!password) {
      showError('Ingresá la contraseña');
      passwordInput.focus();
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Error al iniciar sesión');
        setLoading(false);
        return;
      }

      // Guardar datos de sesión
      localStorage.setItem('rifa_token', data.token);
      localStorage.setItem('rifa_nombre', data.nombre);
      localStorage.setItem('rifa_role', data.role);

      // Redirigir al panel
      window.location.replace('/rifa.html');
    } catch (err) {
      showError('Error de conexión. Revisá tu internet e intentá de nuevo.');
      setLoading(false);
    }
  });

  // Limpiar error al tipear
  nombreInput.addEventListener('input', hideError);
  passwordInput.addEventListener('input', hideError);
})();
