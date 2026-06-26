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

// Inicializar los 500 números en la DB (solo si no existen)
const inicializarNumeros = async () => {
  try {
    const count = await Numero.countDocuments();
    if (count === 0) {
      console.log('⚙️  Inicializando 500 números en la base de datos...');
      const numeros = [];
      for (let i = 1; i <= 500; i++) {
        numeros.push({ numero: i, vendido: false });
      }
      await Numero.insertMany(numeros);
      console.log('✅ 500 números creados correctamente');
    } else {
      console.log(`📊 DB ya tiene ${count} números`);
    }
  } catch (error) {
    console.error('❌ Error al inicializar números:', error);
  }
};

// API REST — obtener todos los números
app.get('/api/numeros', verifyToken, async (req, res) => {
  try {
    const numeros = await Numero.find().sort({ numero: 1 });
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
    const numeros = await Numero.find().sort({ numero: 1 });
    socket.emit('estado_inicial', numeros);
  } catch (err) {
    console.error('Error al enviar estado inicial:', err);
  }

  // Marcar número como vendido
  socket.on('marcar_numero', async (data) => {
    const { numero, comprador } = data;

    if (!numero || numero < 1 || numero > 500) {
      return socket.emit('error_operacion', { mensaje: 'Número inválido' });
    }

    if (!comprador || comprador.trim().length < 2) {
      return socket.emit('error_operacion', { mensaje: 'El nombre del comprador es requerido' });
    }

    try {
      const num = await Numero.findOne({ numero });

      if (!num) {
        return socket.emit('error_operacion', { mensaje: 'Número no encontrado' });
      }

      if (num.vendido) {
        return socket.emit('error_operacion', { mensaje: `El número ${numero} ya fue vendido` });
      }

      num.vendido = true;
      num.vendedor = socket.user.nombre;
      num.comprador = comprador.trim();
      num.fechaVenta = new Date();
      await num.save();

      // Broadcast a todos los clientes
      io.emit('numero_actualizado', num);
      console.log(`🎟️  Número ${numero} marcado por ${socket.user.nombre} → comprador: ${comprador.trim()}`);
    } catch (err) {
      console.error('Error al marcar número:', err);
      socket.emit('error_operacion', { mensaje: 'Error al marcar el número' });
    }
  });

  // Desmarcar número (solo admin)
  socket.on('desmarcar_numero', async (data) => {
    if (socket.user.role !== 'admin') {
      return socket.emit('error_operacion', { mensaje: 'Solo el administrador puede desmarcar números' });
    }

    const { numero } = data;

    if (!numero || numero < 1 || numero > 500) {
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
