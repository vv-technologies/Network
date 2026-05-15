/**
 * Firebase Configuration Template
 * 
 * USAGE:
 * 1. Copy this file: cp firebase-config.example.js firebase-config.js
 * 2. Replace placeholder values with your Firebase project credentials
 * 3. firebase-config.js is in .gitignore — NEVER commit it
 * 
 * Get your config from:
 * Firebase Console → Project Settings → Your apps → SDK setup
 */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"  // optional, for Analytics
};

// Initialize Firebase (imported in main app files)
// firebase.initializeApp(firebaseConfig);
// const db = firebase.firestore();

module.exports = firebaseConfig;