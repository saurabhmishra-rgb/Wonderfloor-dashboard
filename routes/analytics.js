// routes/analytics.js
const express = require('express');
const router = express.Router();
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

// const analyticsDataClient = new BetaAnalyticsDataClient({
//   keyFilename: process.env.GA4_KEY_PATH,
// });

const credentials = process.env.GA4_KEY_JSON
  ? JSON.parse(process.env.GA4_KEY_JSON)
  : undefined;

const analyticsDataClient = new BetaAnalyticsDataClient(
  credentials
    ? { credentials }
    : { keyFilename: process.env.GA4_KEY_PATH }
);

const propertyId = process.env.GA4_PROPERTY_ID;

// GET /analytics/ga4-summary?days=14
router.get('/ga4-summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;

    const [summaryResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
      ],
    });

    const [trendResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const summaryRow = summaryResponse.rows?.[0]?.metricValues || [];
    const trend = (trendResponse.rows || []).map((row) => ({
      date: row.dimensionValues[0].value, // format: YYYYMMDD
      activeUsers: Number(row.metricValues[0].value),
    }));

    res.json({
      success: true,
      totalVisitors: Number(summaryRow[0]?.value || 0),
      newUsers: Number(summaryRow[1]?.value || 0),
      sessions: Number(summaryRow[2]?.value || 0),
      pageViews: Number(summaryRow[3]?.value || 0),
      trend,
    });
  } catch (err) {
    console.error('GA4 fetch failed:', err.message);
    res.status(500).json({ success: false, error: 'GA4 data fetch failed' });
  }
});

module.exports = router;
