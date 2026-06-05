require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const Product = require('./models/Product');
const Room = require('./models/Room');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Multer (Stores file in memory so we can send to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ storage });


// ─── SERVERLESS MONGODB CACHED CONNECTION COUPLING ───
let cachedConnection = null;

async function connectToDatabase() {
  // If connection exists in the serverless instance container memory, reuse it
  if (cachedConnection) return cachedConnection;

  // Fallback check if mongoose is already connected via readyState
  if (mongoose.connection.readyState === 1) {
    cachedConnection = mongoose.connection;
    return cachedConnection;
  }

  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    // serverSelectionTimeoutMS limits hanging to 5s so function execution doesn't bleed out
    cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(' Connected to MongoDB');
    return cachedConnection;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    throw err;
  }
}

// Global Middleware: Forces the route runner to wait for DB connection handshake completion
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});


// ─── CLOUDINARY CONNECTION TEST ───
// Wrapped in try/catch to avoid freezing server processes if cloud pings delay
cloudinary.api.ping()
  .then(res => {
    if (res.status === 'ok') console.log(' Connected to Cloudinary');
  })
  .catch(err => console.error(' Cloudinary connection error:', err.message));

// Helper function to upload buffer to Cloudinary
const uploadToCloudinary = (fileBuffer, folderName, mimeType = 'image/jpeg') => {
  return new Promise((resolve, reject) => {
    const b64 = Buffer.from(fileBuffer).toString("base64");
    const dataURI = `data:${mimeType};base64,` + b64;
    
    cloudinary.uploader.upload(dataURI, { folder: folderName }, (error, result) => {
      if (error) reject(error);
      else resolve(result.secure_url);
    });
  });
};

// ─── 1. UPLOAD TILE (PRODUCT) ───
app.post('/upload/product', upload.single('tileImage'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No tile image provided' });

    const imageUrl = await uploadToCloudinary(req.file.buffer, 'wonderfloor/tiles');
    const industries = req.body.userIndustry ? JSON.parse(req.body.userIndustry) : [];

    const newProduct = new Product({
      ...req.body,
      userIndustry: industries,
      img: imageUrl
    });
    await newProduct.save();

    res.status(201).json({ success: true, product: newProduct });
  } catch (error) {
    console.error("Product upload error:", error);
    res.status(500).json({ error: 'Failed to upload product' });
  }
});

// ─── 2. UPLOAD ROOM (BASE + MASK) ───
app.post('/upload/room', upload.fields([
  { name: 'baseImage', maxCount: 1 },
  { name: 'maskImage', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.baseImage) {
      return res.status(400).json({ error: 'Base image is required' });
    }

    const previewUrl = await uploadToCloudinary(
      req.files.baseImage[0].buffer, 
      'wonderfloor/rooms',
      req.files.baseImage[0].mimetype  
    );
    
    let maskUrl = null; 
    if (req.files.maskImage) {
      maskUrl = await uploadToCloudinary(
        req.files.maskImage[0].buffer, 
        'wonderfloor/masks',
        req.files.maskImage[0].mimetype  
      );
    }

    const collections = req.body.supportedCollections ? JSON.parse(req.body.supportedCollections) : [];

    const newRoom = new Room({
      name: req.body.name,
      category: req.body.category,
      supportedCollections: collections,
      previewUrl: previewUrl,
      maskUrl: maskUrl
    });
    await newRoom.save();

    res.status(201).json({ success: true, room: newRoom });
  } catch (error) {
    console.error("Room upload error:", error);
    res.status(500).json({ error: 'Failed to upload room' });
  }
});

// ─── 3. FETCH ROUTES ───
app.get('/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/rooms', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ createdAt: -1 });
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// ─── 4. DASHBOARD STATS ROUTE ───
app.get('/dashboard-stats', async (req, res) => {
  try {
    const roomCount = await Room.countDocuments();
    const productCount = await Product.countDocuments();
    
    const recentRooms = await Room.find().sort({ createdAt: -1 }).limit(3).lean();
    const formattedRooms = recentRooms.map(r => ({
      id: r._id,
      name: r.name,
      thumb: r.previewUrl,
      file: r.previewUrl.split('/').pop().split('?')[0],
      type: 'Room',
      category: r.category,
      createdAt: r.createdAt
    }));

    const recentProducts = await Product.find().sort({ createdAt: -1 }).limit(3).lean();
    const formattedProducts = recentProducts.map(p => ({
      id: p._id,
      name: p.name,
      thumb: p.img,
      file: p.img.split('/').pop().split('?')[0],
      type: 'Tile',
      category: p.accordionCategory || p.navCategory,
      createdAt: p.createdAt
    }));

    const recentUploads = [...formattedRooms, ...formattedProducts]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 4);

    res.status(200).json({
      stats: {
        totalRooms: roomCount,
        totalProducts: productCount,
        totalRecords: roomCount + productCount
      },
      recentUploads
    });
  } catch (error) {
    console.error("Stats fetch error:", error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// ─── ADD A ROOT WELCOME STATUS ROUTE ───
app.get('/', (req, res) => {
  res.status(200).json({ API: "Online", platform: "Wonderfloor Serverless API" });
});

// ─── MODIFIED FOR VERCEL ───
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, () => {
    console.log(`🚀 Local Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;