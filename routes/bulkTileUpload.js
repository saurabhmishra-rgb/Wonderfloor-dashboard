// routes/bulkTileUpload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Product = require('../models/Product');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadToCloudinary = (fileBuffer, folderName, mimeType = 'image/jpeg') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: folderName, resource_type: 'image' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    const { Readable } = require('stream');
    const readable = new Readable();
    readable._read = () => {};
    readable.push(fileBuffer);
    readable.push(null);
    readable.pipe(stream);
  });
};

// ─── ROBUST CSV PARSER ───
// Safely handles newlines inside quotes, commas inside quotes, and trims extra spaces.
function parseCSV(text) {
  const result = [];
  let row = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++; 
      row.push(current.trim());
      if (row.some(cell => cell !== '')) result.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.some(cell => cell !== '')) result.push(row);
  }
  return result;
}

router.post('/bulk-products-combined', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'images', maxCount: 200 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'Missing spreadsheet data file (.csv)' });
    }

    const dataBuffer = req.files.file[0].buffer.toString('utf8');
    const imageFiles = req.files.images || [];

    const imageMap = {};
    imageFiles.forEach(file => {
      const baseName = file.originalname.split('.').slice(0, -1).join('.').trim().toLowerCase();
      imageMap[baseName] = file;
    });

    // Use the robust parser instead of basic regex splitting
    const parsedRows = parseCSV(dataBuffer);
    if (parsedRows.length < 2) {
      return res.status(400).json({ error: 'Spreadsheet template contains no record data rows' });
    }

    const headers = parsedRows[0];
    const savedProducts = [];
    const skippedRecords = [];

    // ── FORWARD-FILL MEMORY TRACKERS ──
    let currentNavCategory = 'Flooring Products'; 
    let currentAccordionCategory = 'Uncategorized';
    let currentProductLink = '';
    let currentUserIndustry = '';
    let currentApplicationArea = '';
    let currentTags = '';
    let currentDescription = '';

    for (let i = 1; i < parsedRows.length; i++) {
      const rowData = parsedRows[i];
      
      const record = {};
      headers.forEach((header, index) => {
        record[header] = rowData[index] || '';
      });

      const name = record['Product Name/ Display Name'] || record['name'];
      const sku = record['SKU'] || record['sku'];
      
      if (!sku || !name) continue;

      // ── UPDATE TRACKERS IF ROW HAS DATA ──
      if (record['navCategory']) currentNavCategory = record['navCategory'];
      
      if (record['Product Collection']) currentAccordionCategory = record['Product Collection'];
      else if (record['accordionCategory']) currentAccordionCategory = record['accordionCategory'];

      if (record['Product Link']) currentProductLink = record['Product Link'];
      if (record['User Industry - Parent category as per website data']) currentUserIndustry = record['User Industry - Parent category as per website data'];
      if (record['Application Area - Display Data (Product Popup)']) currentApplicationArea = record['Application Area - Display Data (Product Popup)'];
      if (record['Searchable Tags']) currentTags = record['Searchable Tags'];
      if (record['Description']) currentDescription = record['Description'];

      // Robust comma & semicolon list splitter
      const parseListFields = (rawString) => {
        if (!rawString) return [];
        return rawString.split(/[,;]/).map(item => item.trim()).filter(Boolean);
      };

      let finalImageUrl = null;
      const rawImageFieldName = record['Product Sample Image Name'] ? record['Product Sample Image Name'].toLowerCase() : '';

      if (rawImageFieldName) {
        const cleanImageKey = rawImageFieldName.includes('.')
          ? rawImageFieldName.split('.').slice(0, -1).join('.')
          : rawImageFieldName;

        if (imageMap[cleanImageKey]) {
          try {
            const targetImageFile = imageMap[cleanImageKey];
            finalImageUrl = await uploadToCloudinary(targetImageFile.buffer, 'wonderfloor/tiles', targetImageFile.mimetype);
          } catch (uploadError) {
            console.error(`Cloudinary upload failed for: ${rawImageFieldName}`, uploadError);
          }
        }
      }

      // Assemble dataset 
      const updateData = {
        name: name,
        size: record['Size'] || record['size'] || 'N/A',
        thickness: record['Thickness'] || record['thickness'] || '',
        style: record['Style'] || record['style'] || '',
        colour: record['Colour Family'] || record['colour'] || 'N/A',
        shade: record['Shade'] || record['shade'] || 'N/A',
        pattern: record['Pattern/ Layout'] || record['pattern'] || '',
        productLink: currentProductLink,
        description: currentDescription,
        navCategory: 'Flooring Products', // Forces them into the main tab
        accordionCategory: currentAccordionCategory, 
        userIndustry: parseListFields(currentUserIndustry),
        applicationArea: parseListFields(currentApplicationArea),
        tags: parseListFields(currentTags),
        isVisible: true
      };

      if (finalImageUrl) {
        updateData.img = finalImageUrl;
      }

      try {
        const productDoc = await Product.findOneAndUpdate(
          { sku: sku },
          { $set: updateData },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
        savedProducts.push(productDoc);
      } catch (dbError) {
        skippedRecords.push({ sku: sku, error: dbError.message });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Processing complete.',
      recordsImported: savedProducts.length,
      failures: skippedRecords
    });

  } catch (error) {
    console.error("Critical error in bulk parsing stream logic:", error);
    res.status(500).json({ error: 'Server configuration error encountered parsing document archives.' });
  }
});

module.exports = router;
