/*
FIRESTORE SECURITY RULES to paste into Firebase Console:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
*/

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, addDoc, serverTimestamp, query, where, orderBy, limit } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDQfXIK8aHxlM__qwUfib3C3vRe5dp5jro",
  authDomain: "bizzassistai.firebaseapp.com",
  projectId: "bizzassistai",
  storageBucket: "bizzassistai.firebasestorage.app",
  messagingSenderId: "413886615978",
  appId: "1:413886615978:web:e27176076949ae10809bd3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
