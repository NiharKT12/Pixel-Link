const mongoose = require('mongoose');

// Durable ID source used when Redis is unavailable. `findOneAndUpdate`
// with `$inc` is atomic in MongoDB, so this is safe under concurrency.
const counterSchema = new mongoose.Schema({
    _id: { type: String },
    seq: { type: Number, default: 0 }
});

module.exports = mongoose.model('Counter', counterSchema);
