const mongoose = require('mongoose');

const numeroSchema = new mongoose.Schema({
  numero: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 500,
  },
  vendido: {
    type: Boolean,
    default: false,
  },
  vendedor: {
    type: String,
    default: null,
  },
  comprador: {
    type: String,
    default: null,
  },
  fechaVenta: {
    type: Date,
    default: null,
  },
});

module.exports = mongoose.model('Numero', numeroSchema);
