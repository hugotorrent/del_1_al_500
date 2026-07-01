require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const connectDB = require('./db');
const Numero = require('./models/Numero');
const authRoutes = require('./routes/auth');
const { verifyToken } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api', authRoutes);

const getRifaRange = () => {
  const start = Number.parseInt(process.env.RIFA_START || '1', 10);
  const end = Number.parseInt(process.env.RIFA_END || '500', 10);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return { start: 1, end: 500 };
  }

  return { start, end };
};

const { start: RIFA_START, end: RIFA_END } = getRifaRange();

// Inicializar los números configurados en la DB (insertando solo los faltantes)
const inicializarNumeros = async () => {
  try {
    const numerosEsperados = [];
    for (let i = RIFA_START; i <= RIFA_END; i++) {
      numerosEsperados.push(i);
    }

    const existentes = await Numero.find({ numero: { $gte: RIFA_START, $lte: RIFA_END } }, 'numero');
    const existentesSet = new Set(existentes.map((n) => n.numero));
    const faltantes = numerosEsperados.filter((numero) => !existentesSet.has(numero));

    if (faltantes.length > 0) {
      console.log(`⚙️  Inicializando ${faltantes.length} números en la base de datos (${RIFA_START} a ${RIFA_END})...`);
      const numeros = faltantes.map((numero) => ({ numero, vendido: false }));
      await Numero.insertMany(numeros);
      console.log(`✅ ${faltantes.length} números creados correctamente`);
    }

    const total = await Numero.countDocuments({ numero: { $gte: RIFA_START, $lte: RIFA_END } });
    console.log(`📊 DB tiene ${total} números para la rifa ${RIFA_START}-${RIFA_END}`);
  } catch (error) {
    console.error('❌ Error al inicializar números:', error);
  }
};

// API REST — obtener todos los números
app.get('/api/numeros', verifyToken, async (req, res) => {
  try {
    const numeros = await Numero.find({ numero: { $gte: RIFA_START, $lte: RIFA_END } }).sort({ numero: 1 });
    res.json(numeros);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener números' });
  }
});

// Socket.io — Middleware de autenticación
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token requerido'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

// Socket.io — Manejo de conexiones
io.on('connection', async (socket) => {
  console.log(`🔌 Conectado: ${socket.user.nombre} (${socket.user.role})`);

  // Enviar estado actual al cliente recién conectado
  try {
    const numeros = await Numero.find({ numero: { $gte: RIFA_START, $lte: RIFA_END } }).sort({ numero: 1 });
    socket.emit('estado_inicial', numeros);
  } catch (err) {
    console.error('Error al enviar estado inicial:', err);
  }

  // Marcar número como vendido
  socket.on('marcar_numero', async (data) => {
    const numeros = Array.isArray(data.numeros) ? data.numeros : data.numero ? [data.numero] : [];
    const comprador = data.comprador;

    if (!Array.isArray(numeros) || numeros.length === 0) {
      return socket.emit('error_operacion', { mensaje: 'Debe seleccionar al menos un número' });
    }

    if (!comprador || comprador.trim().length < 2) {
      return socket.emit('error_operacion', { mensaje: 'El nombre del comprador es requerido' });
    }

    const numerosValidos = numeros
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= RIFA_START && n <= RIFA_END);

    if (numerosValidos.length !== numeros.length) {
      return socket.emit('error_operacion', { mensaje: 'Uno o más números son inválidos' });
    }

    const uniqueNumeros = [...new Set(numerosValidos)];
    if (uniqueNumeros.length !== numerosValidos.length) {
      return socket.emit('error_operacion', { mensaje: 'Hay números duplicados en la selección' });
    }

    try {
      const docs = await Numero.find({ numero: { $in: uniqueNumeros } });
      if (docs.length !== uniqueNumeros.length) {
        return socket.emit('error_operacion', { mensaje: 'Uno o más números no se encontraron' });
      }

      const yaVendidos = docs.filter((d) => d.vendido);
      if (yaVendidos.length > 0) {
        return socket.emit('error_operacion', { mensaje: `El número ${yaVendidos[0].numero} ya fue vendido` });
      }

      const now = new Date();
      await Numero.updateMany(
        { numero: { $in: uniqueNumeros }, vendido: false },
        { vendido: true, vendedor: socket.user.nombre, comprador: comprador.trim(), fechaVenta: now }
      );

      const updated = await Numero.find({ numero: { $in: uniqueNumeros } }).sort({ numero: 1 });
      updated.forEach((num) => io.emit('numero_actualizado', num));
      console.log(`🎟️  Números ${uniqueNumeros.join(', ')} marcados por ${socket.user.nombre} → comprador: ${comprador.trim()}`);
    } catch (err) {
      console.error('Error al marcar número:', err);
      socket.emit('error_operacion', { mensaje: 'Error al marcar los números' });
    }
  });

  // Desmarcar número (solo admin)
  socket.on('desmarcar_numero', async (data) => {
    if (socket.user.role !== 'admin') {
      return socket.emit('error_operacion', { mensaje: 'Solo el administrador puede desmarcar números' });
    }

    const { numero } = data;

    if (!numero || numero < RIFA_START || numero > RIFA_END) {
      return socket.emit('error_operacion', { mensaje: 'Número inválido' });
    }

    try {
      const num = await Numero.findOne({ numero });

      if (!num) {
        return socket.emit('error_operacion', { mensaje: 'Número no encontrado' });
      }

      if (!num.vendido) {
        return socket.emit('error_operacion', { mensaje: `El número ${numero} ya está disponible` });
      }

      num.vendido = false;
      num.vendedor = null;
      num.comprador = null;
      num.fechaVenta = null;
      await num.save();

      io.emit('numero_actualizado', num);
      console.log(`🔓 Número ${numero} desmarcado por admin ${socket.user.nombre}`);
    } catch (err) {
      console.error('Error al desmarcar número:', err);
      socket.emit('error_operacion', { mensaje: 'Error al desmarcar el número' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Desconectado: ${socket.user.nombre}`);
  });
});

// Arrancar servidor
const PORT = process.env.PORT || 3000;

connectDB().then(async () => {
  await inicializarNumeros();
  server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  });
});
