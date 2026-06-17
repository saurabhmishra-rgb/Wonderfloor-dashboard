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


function safeParseJSON(data) {
  if (!data) return [];
  if (typeof data !== 'string') return data; 
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn("⚠️ Could not parse JSON, falling back to string split:", data);
    return data.replace(/[\[\]\\"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  }
}

// Configure Cloudinary
// ✅ FIX 1: Added timeout — prevents the 499 TimeoutError on large files
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: 120_000, // 120 s — gives Cloudinary enough time even on slow connections
});

// ✅ FIX 2: Added fileSize limit to multer so oversized files are rejected fast
//    rather than timing out silently after a long upload.
//    10 MB is generous for a tile texture; adjust down if you want stricter enforcement.
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard cap
});


// ─── SERVERLESS MONGODB CACHED CONNECTION COUPLING ───
let cachedConnection = null;

async function connectToDatabase() {
  if (cachedConnection) return cachedConnection;

  if (mongoose.connection.readyState === 1) {
    cachedConnection = mongoose.connection;
    return cachedConnection;
  }

  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ Connected to MongoDB');
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
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// ─── CLOUDINARY CONNECTION TEST ───
cloudinary.api.ping()
  .then(res => {
    if (res.status === 'ok') console.log('✅ Connected to Cloudinary');
  })
  .catch(err => console.error('❌ Cloudinary connection error:', err.message));


// ✅ FIX 3: Replaced base64 helper with upload_stream.
//
//  OLD approach (causes timeouts):
//    const b64 = Buffer.from(fileBuffer).toString("base64");       // bloats size ~33%
//    const dataURI = `data:${mimeType};base64,` + b64;
//    cloudinary.uploader.upload(dataURI, options, callback);       // sends inflated string
//
//  NEW approach (fast, memory-efficient):
//    pipe the raw buffer directly into a Cloudinary upload stream.
//    No base64 conversion = smaller payload, lower latency, no timeout.
const uploadToCloudinary = (fileBuffer, folderName, mimeType = 'image/jpeg') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folderName, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );

    // Push the buffer into the stream and signal end-of-data
    const { Readable } = require('stream');
    const readable = new Readable();
    readable._read = () => { };
    readable.push(fileBuffer);
    readable.push(null);
    readable.pipe(stream);
  });
};


// ─── ROOT WELCOME STATUS ROUTE ───
app.get('/', (req, res) => {
  res.status(200).json({ API: "Online", platform: "Wonderfloor Serverless API" });
});


// ─── CLOUDINARY SIGNED UPLOAD TOKEN ───────────────────────────────────────────
// The frontend calls this first, gets a short-lived signature, then uploads the
// image file DIRECTLY from the browser to Cloudinary — skipping this server
// entirely. This eliminates the server→Cloudinary hop that was causing 499s.
app.get('/sign-upload', (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = req.query.folder || 'wonderfloor/tiles';

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      signature,
      timestamp,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      folder,
    });
  } catch (err) {
    console.error('Sign-upload error:', err);
    res.status(500).json({ error: 'Could not generate upload signature' });
  }
});


// ══════════════════════════════════════════════
//  PRODUCT ROUTES
// ══════════════════════════════════════════════

// ─── UPLOAD TILE (PRODUCT) ───────────────────────────────────────────────────
// Accepts two upload paths:
//   1. imageUrl in body  -> browser uploaded directly to Cloudinary; just save URL.
//   2. tileImage file    -> fallback server-side upload (used by bulk-upload route).
// ─── UPLOAD TILE (PRODUCT) ───────────────────────────────────────────────────
app.post('/upload/product', upload.single('tileImage'), async (req, res) => {
  try {
    let imageUrl;

    if (req.body.imageUrl) {
      imageUrl = req.body.imageUrl;
    } else if (req.file) {
      imageUrl = await uploadToCloudinary(req.file.buffer, 'wonderfloor/tiles');
    } else {
      return res.status(400).json({ error: 'No tile image provided' });
    }

    // 👇 USE THE SAFE PARSER HERE 👇
    const industries = safeParseJSON(req.body.userIndustry);
    const applicationArea = safeParseJSON(req.body.applicationArea);
    const tagsArray = safeParseJSON(req.body.tags);
    // 👆 ---------------------- 👆
    
    const { imageUrl: _ignored, ...restBody } = req.body;

    const newProduct = new Product({
      ...restBody,
      userIndustry: industries,
      applicationArea: applicationArea, 
      tags: tagsArray,
      img: imageUrl,
    });
    await newProduct.save();

    res.status(201).json({ success: true, product: newProduct });
  } catch (error) {
    // Friendly duplicate-SKU error
    if (error.code === 11000 && error.keyPattern && error.keyPattern.sku) {
      return res.status(409).json({
        error: 'SKU "' + error.keyValue.sku + '" already exists. Please use a different SKU code.'
      });
    }
    console.error("Product upload error:", error);
    res.status(500).json({ error: 'Failed to upload product' });
  }
});

// ─── FETCH ALL PRODUCTS ───
app.get('/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();

    // ── NORMALIZE: old docs without isVisible field get treated as visible ──
    // Mongoose casts missing Boolean fields to false — this corrects that
    const normalized = products.map(p => ({
      ...p,
      isVisible: p.isVisible !== false  // undefined → true, false → false, true → true
    }));

    res.status(200).json(normalized);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ─── FETCH SINGLE PRODUCT BY ID ───
app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Target product not found' });
    }
    res.status(200).json(product);
  } catch (error) {
    console.error("Single product fetch crash:", error);
    res.status(500).json({ error: 'Server error pulling item parameters' });
  }
});

// ─── TOGGLE PRODUCT VISIBILITY ───
// Flips isVisible between true ↔ false for a single product.
// Old documents that pre-date this field will have isVisible=undefined,
// which we treat as true (visible), so the first toggle correctly hides them.
app.patch('/products/:id/visibility', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    product.isVisible = product.isVisible === false ? true : false;
    await product.save();
    console.log(`👁 "${product.name}" visibility → ${product.isVisible}`);
    res.status(200).json({ success: true, id: product._id, name: product.name, isVisible: product.isVisible });
  } catch (error) {
    console.error("Visibility toggle error:", error);
    res.status(500).json({ error: 'Failed to update product visibility' });
  }
});


// ══════════════════════════════════════════════
//  ROOM ROUTES
// ══════════════════════════════════════════════

// ─── UPLOAD ROOM (BASE + MASK) ───
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

    const collections = req.body.supportedCollections
      ? JSON.parse(req.body.supportedCollections)
      : [];

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

// ─── FETCH ALL ROOMS ───
app.get('/rooms', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ createdAt: -1 });
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// ─── FETCH SINGLE ROOM BY ID ───
app.get('/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Target room not found' });
    res.status(200).json(room);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});


// ══════════════════════════════════════════════
//  DASHBOARD STATS ROUTE
// ══════════════════════════════════════════════

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


// ─── LOCAL DEV SERVER ───
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, () => {
    console.log(`🚀 Local Server running on http://localhost:${PORT}`);
  });
}

// ─── ONE-TIME MIGRATION (delete after running once) ───
app.post('/migrate/fix-visibility', async (req, res) => {
  try {
    const result = await Product.updateMany(
      { isVisible: { $exists: false } },
      { $set: { isVisible: true } }
    );
    res.json({ fixed: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── TOGGLE ROOM LIVE STATUS ───
app.patch('/rooms/:id/toggle-live', async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    room.isLive = !room.isLive;
    await room.save();

    console.log(`🟢 "${room.name}" isLive → ${room.isLive}`);
    res.json({ _id: room._id, isLive: room.isLive });
  } catch (err) {
    res.status(500).json({ error: 'Toggle failed' });
  }
});

// ─── BULK TOGGLE ALL ROOMS IN A CATEGORY ───
app.patch('/rooms/bulk-toggle-live', async (req, res) => {
  try {
    const { category, isLive } = req.body;
    if (!category || isLive === undefined) {
      return res.status(400).json({ error: 'category and isLive are required' });
    }
    await Room.updateMany({ category }, { $set: { isLive } });
    const updatedRooms = await Room.find({ category }).lean();
    res.json({ success: true, updatedRooms });
  } catch (err) {
    res.status(500).json({ error: 'Bulk toggle failed' });
  }
});


// ─── UPDATE PRODUCT BY ID WITH IMAGE UPLOAD ───
app.patch('/products/:id', upload.single('tileImage'), async (req, res) => {
  try {
    let updateData = { ...req.body };

    // 1. Parse stringified array from FormData if it exists
   if (req.body.userIndustry !== undefined) {
      updateData.userIndustry = safeParseJSON(req.body.userIndustry);
    }
    if (req.body.applicationArea !== undefined) {
      updateData.applicationArea = safeParseJSON(req.body.applicationArea); 
    }
    if (req.body.tags !== undefined) {
      updateData.tags = safeParseJSON(req.body.tags);
    }
    // 2. If a new file is provided, upload it to Cloudinary and update the image property
    if (req.file) {
      console.log(`🔄 Uploading new image asset for product ID: ${req.params.id}...`);
      const imageUrl = await uploadToCloudinary(req.file.buffer, 'wonderfloor/tiles');
      updateData.img = imageUrl;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { returnDocument: 'after' }
    );

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({ message: 'Server error updating item fields', error: error.message });
  }
});


// ─── DELETE PRODUCT ───
app.delete('/products/:id', async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json({ success: true, message: 'Product successfully deleted' });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ─── UPDATE ROOM BY ID WITH TEXT AND IMAGE UPLOADS ───
app.patch('/rooms/:id', upload.fields([
  { name: 'previewImage', maxCount: 1 },
  { name: 'maskImage', maxCount: 1 }
]), async (req, res) => {
  try {
    let updateData = { ...req.body };

    // 1. Parse stringified arrays back into real arrays
    if (req.body.supportedCollections) {
      updateData.supportedCollections = JSON.parse(req.body.supportedCollections);
    }

    // 2. Upload new Base Room Image to Cloudinary if provided
    if (req.files && req.files.previewImage) {
      console.log(`🔄 Uploading new base image for room ID: ${req.params.id}...`);
      const previewUrl = await uploadToCloudinary(
        req.files.previewImage[0].buffer,
        'wonderfloor/rooms',
        req.files.previewImage[0].mimetype
      );
      updateData.previewUrl = previewUrl;
    }

    // 3. Upload new Mask Image to Cloudinary if provided
    if (req.files && req.files.maskImage) {
      console.log(`🔄 Uploading new mask image for room ID: ${req.params.id}...`);
      const maskUrl = await uploadToCloudinary(
        req.files.maskImage[0].buffer,
        'wonderfloor/masks',
        req.files.maskImage[0].mimetype
      );
      updateData.maskUrl = maskUrl;
    }

    // 4. Save to Database
    const updatedRoom = await Room.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, returnDocument: 'after' }
    );

    if (!updatedRoom) {
      return res.status(404).json({ error: 'Room not found' });
    }

    console.log(`✅ Room "${updatedRoom.name}" successfully updated.`);
    res.status(200).json(updatedRoom);
  } catch (error) {
    console.error("Update room error:", error);
    res.status(500).json({ message: 'Server error updating room fields', error: error.message });
  }
});

// ─── DELETE ROOM BY ID ───
app.delete('/rooms/:id', async (req, res) => {
  try {
    const deletedRoom = await Room.findByIdAndDelete(req.params.id);

    if (!deletedRoom) {
      return res.status(404).json({ error: 'Target room document not found' });
    }

    console.log(`🗑 Room "${deletedRoom.name}" permanently dropped from database.`);
    res.status(200).json({ success: true, message: 'Room successfully deleted' });
  } catch (error) {
    console.error("Delete room endpoint error:", error);
    res.status(500).json({ error: 'Server database interaction failure dropping room document' });
  }
});

// ─── MULTER & GLOBAL ERROR HANDLER ───
// Must come after all routes so Express treats it as an error-handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum allowed size is 10 MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  // Pass any other errors down to Express's default handler
  next(err);
});

const path = require('path');

// Serve static frontend build
app.use(express.static(path.join(__dirname, 'build'))); // or 'dist'

// ✅ SPA catch-all — must come AFTER all API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ─── MUST ALWAYS BE THE VERY LAST LINE ───
module.exports = app;
