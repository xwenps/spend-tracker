## Config

If hosting locally, you can store the Google Client ID and Sheet ID for autofilling within a `config.json`

```
{
  "clientId": "<SOMETHING>.apps.googleusercontent.com",
  "sheetId":  "<SHEET ID>",
  "years":    ["2023", "2024", "2025", "2026"]
}
```
## Pre-Reqs

### Source Data
Assumption is source data is hosted on Google Sheets. You will need the `SHEET ID` from your source data's URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={SHEET_NAME}`

The source data has the following required columns
```
date: date transaction was posted
amount: amount of the transaction (signed)
category: category assigned to the transaction
```

### Google Credentials
This app currently pulls directly from Google Sheets using OAuth2 scopes. 
You must enable API access to Google Sheets, create an OAuth2 Client ID and set restrictions to allow from the proper website URIs.

#### Step 1: Create a Google Cloud Project
1. Go to console.cloud.google.com
2. Click the project dropdown at the top → New Project
3. Name it anything (e.g., "Spend Tracker") and click Create
4. Make sure the new project is selected in the dropdown
​
#### Step 2: Enable the Google Sheets API
1. In the left menu, go to APIs & Services → Library
2. Search for "Google Sheets API"
3. Click it and hit Enable

#### Step 3: Create the OAuth2 client ID
1. In APIs & Services → Credentials, also create an OAuth 2.0 Client ID (type: Web application)
2. Add `http://localhost` (or alternative hosted origin ie. ` https://xwenps.github.io`) to Authorized JavaScript origins
3. You'll use the `Client ID` to connect

## How to use

### Github Hosted Page

Link: https://xwenps.github.io/spend-analyzer/

1) 

### Local Run
```
cd your-folder
python3 -m http.server 8080
```

open http://localhost:8080 in your browser

### Data Processor

Data processor takes CSV exports from various financial institutes and transforms the raw data into the standard schema expected by the Spend Analyzer
