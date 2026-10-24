// Vercel Speed Insights initialization for vanilla JavaScript
// This file uses the @vercel/speed-insights package to track web performance metrics

import { injectSpeedInsights } from './assets/speed-insights.mjs';

// Initialize Speed Insights
// This will automatically track Core Web Vitals and other performance metrics
injectSpeedInsights({
  debug: false, // Set to true to see debug logs in development
});
