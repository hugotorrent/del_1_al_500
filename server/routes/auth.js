const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// POST /api/login
router.post('/login', (req, res) => {
  const { nombre, password } = req.body;

  if (!nombre || nombre.trim().length < 2) {
    return res.status(400).json({ error: 'Ingresá tu nombre (mínimo 2 caracteres)' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Contraseña requerida' });
  }

  const nombreLimpio = nombre.trim();
  let role = null;

  if (password === process.env.ADMIN_PASSWORD) {
    role = 'admin';
  } else if (password === process.env.RIFA_PASSWORD) {
    role = 'vendedor';
  } else {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const token = jwt.sign(
    { nombre: nombreLimpio, role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    nombre: nombreLimpio,
    role,
    message: role === 'admin' ? 'Bienvenido, Administrador' : `Bienvenido, ${nombreLimpio}`,
  });
});

module.exports = router;
