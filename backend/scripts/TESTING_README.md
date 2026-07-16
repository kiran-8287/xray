# UI Performance Testing Guide

This guide explains how to test the library page UI with different dataset sizes (1000 to 10000 items).

## Generated Test Data

Test data files have been generated in `backend/data/`:
- `items_1000.json` (2.06 MB) - 400 bags, 350 threats, 250 non-threats
- `items_2000.json` (4.14 MB) - 800 bags, 700 threats, 500 non-threats
- `items_3000.json` (6.24 MB) - 1200 bags, 1050 threats, 750 non-threats
- `items_4000.json` (8.29 MB) - 1600 bags, 1400 threats, 1000 non-threats
- `items_5000.json` (10.37 MB) - 2000 bags, 1750 threats, 1250 non-threats
- `items_6000.json` (12.39 MB) - 2400 bags, 2100 threats, 1500 non-threats
- `items_7000.json` (14.48 MB) - 2800 bags, 2450 threats, 1750 non-threats
- `items_8000.json` (16.59 MB) - 3200 bags, 2800 threats, 2000 non-threats
- `items_9000.json` (18.58 MB) - 3600 bags, 3150 threats, 2250 non-threats
- `items_10000.json` (20.70 MB) - 4000 bags, 3500 threats, 2500 non-threats

## Quick Start

### Step 1: Backup Current Data (Optional but Recommended)

```bash
node backend/scripts/switchTestData.js
```

This will automatically backup your current `items.json` to `items_backup.json`.

### Step 2: Switch to a Test Dataset

```bash
# Switch to 1000 items
node backend/scripts/switchTestData.js 1000

# Switch to 5000 items
node backend/scripts/switchTestData.js 5000

# Switch to 10000 items
node backend/scripts/switchTestData.js 10000
```

### Step 3: Restart Backend Server

```bash
# Stop the current backend server (if running)
# Then restart it:
cd backend
npm run dev
```

### Step 4: Test the UI

1. Open your browser and navigate to the library page
2. Observe the following:
   - **Load time**: How long does it take to display items?
   - **Scrolling performance**: Is scrolling smooth?
   - **Search performance**: How fast does search work?
   - **Selection performance**: Can you select multiple items quickly?
   - **Category switching**: How fast does switching between categories work?
   - **Memory usage**: Check browser DevTools Memory tab

### Step 5: Restore Original Data

```bash
node backend/scripts/switchTestData.js restore
```

Then restart the backend server again.

## Available Commands

```bash
# List all available test datasets
node backend/scripts/switchTestData.js list

# Switch to a specific dataset
node backend/scripts/switchTestData.js <count>

# Restore original data from backup
node backend/scripts/switchTestData.js restore

# Show help
node backend/scripts/switchTestData.js help
```

## Data Structure

Each test item includes:
- **Unique ID**: `TEST-00001`, `TEST-00002`, etc.
- **Category**: bags (40%), threats (35%), non-threats (25%)
- **Subcategory**: Various subcategories (Backpack, Briefcase, TP02, TP05, etc.)
- **Image reference**: Reuses existing 37 PNG files from `library_images/`
- **Pixel data reference**: Reuses existing 37 .npz files from `pixel_data/highenrgy/`
- **Valid region points**: Generated for all bag items (20-30 point polygons)
- **Tags**: Random tags for bags
- **Dimensions**: Random widths/heights (512-768px)

## What to Test

### Performance Metrics to Monitor

1. **Initial Load Time**
   - Time to first meaningful paint
   - Time to load all items in current category

2. **Scrolling Performance**
   - Frame rate during scroll (should be 60fps)
   - Jank or stuttering

3. **Search Performance**
   - Time to filter items as you type
   - Responsiveness with large datasets

4. **Selection Performance**
   - Speed of selecting/deselecting items
   - Performance of "Select All" operations

5. **Category/Subcategory Switching**
   - Time to switch between categories
   - Smoothness of transitions

6. **Memory Usage**
   - Browser memory consumption
   - Any memory leaks over time

### Testing Checklist

- [ ] Test with 1000 items (baseline)
- [ ] Test with 3000 items (3x baseline)
- [ ] Test with 5000 items (5x baseline)
- [ ] Test with 10000 items (10x baseline)
- [ ] Test search functionality at each scale
- [ ] Test selection at each scale
- [ ] Test category switching at each scale
- [ ] Document performance issues found
- [ ] Note any UI improvements needed

## Notes

- Test data reuses existing images and pixel data files, so no additional files are needed
- All items have unique IDs to avoid conflicts
- The virtualized grid should handle large datasets, but performance may vary
- If you encounter issues, try testing with smaller datasets first (1000-3000)

## Troubleshooting

**Issue**: Backend server won't start after switching data
- **Solution**: Make sure you restarted the server after switching datasets

**Issue**: Images not loading
- **Solution**: The test data references existing images. Ensure `backend/data/library_images/` has the PNG files

**Issue**: Performance is terrible
- **Solution**: This is expected! The purpose is to identify performance bottlenecks. Document the issues and we can optimize

**Issue**: Want to go back to original data
- **Solution**: Run `node backend/scripts/switchTestData.js restore` and restart the server