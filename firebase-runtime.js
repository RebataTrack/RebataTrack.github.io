// RebataTrack Website Build 128 - classic Firebase runtime bridge.
// This deliberately avoids ES-module imports on GitHub Pages. The page loads the
// Firebase compat SDK first, then this file exposes the exact helpers used by the
// existing Admin/Beta source files through isolated globals.
(function(){
  'use strict';
  try {
    var firebase = window.firebase;
    if (!firebase || typeof firebase.initializeApp !== 'function' || typeof firebase.auth !== 'function') {
      throw new Error('Firebase compatibility SDK did not load.');
    }
    if (typeof firebase.firestore !== 'function') {
      throw new Error('Firebase Firestore compatibility SDK did not load.');
    }

    function initializeApp(config) {
      return firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    }
    function getApps(){ return firebase.apps || []; }
    function getAuth(app){ return app && typeof app.auth === 'function' ? app.auth() : firebase.auth(); }
    var browserSessionPersistence = firebase.auth.Auth.Persistence.SESSION;
    function setPersistence(auth,persistence){ return auth.setPersistence(persistence); }
    function onAuthStateChanged(auth,next,error,complete){ return auth.onAuthStateChanged(next,error,complete); }
    function signOut(auth){ return auth.signOut(); }
    function signInWithEmailAndPassword(auth,email,password){ return auth.signInWithEmailAndPassword(email,password); }
    function signInWithCustomToken(auth,token){ return auth.signInWithCustomToken(token); }
    function sendPasswordResetEmail(auth,email,settings){ return auth.sendPasswordResetEmail(email,settings); }
    function getFirestore(app){ return app && typeof app.firestore === 'function' ? app.firestore() : firebase.firestore(); }
    function isDocumentReference(ref){ return !!ref && typeof ref.set === 'function' && typeof ref.get === 'function'; }
    function wrapDocumentSnapshot(snapshot){
      if(!snapshot) return snapshot;
      return { id:snapshot.id, ref:snapshot.ref, metadata:snapshot.metadata,
        exists:function(){ return !!snapshot.exists; },
        data:function(){ return snapshot.data.apply(snapshot,arguments); },
        get:function(){ return snapshot.get.apply(snapshot,arguments); }
      };
    }
    function doc(parent){
      var segments=[].slice.call(arguments,1);
      if(!parent || typeof parent.doc !== 'function') throw new Error('Invalid Firestore document parent.');
      if(!segments.length) return parent.doc();
      return parent.doc(segments.map(String).join('/'));
    }
    function collection(parent){
      var segments=[].slice.call(arguments,1);
      if(!parent || typeof parent.collection !== 'function') throw new Error('Invalid Firestore collection parent.');
      return parent.collection(segments.map(String).join('/'));
    }
    function getDoc(ref){ return ref.get().then(wrapDocumentSnapshot); }
    function getDocs(ref){ return ref.get(); }
    function setDoc(ref,data,options){ return options ? ref.set(data,options) : ref.set(data); }
    function updateDoc(ref,data){ return ref.update(data); }
    function deleteDoc(ref){ return ref.delete(); }
    function addDoc(ref,data){ return ref.add(data); }
    function serverTimestamp(){ return firebase.firestore.FieldValue.serverTimestamp(); }
    function deleteField(){ return firebase.firestore.FieldValue.delete(); }
    var Timestamp = firebase.firestore.Timestamp;
    function writeBatch(db){ return db.batch(); }
    function where(fieldPath,opStr,value){ return {kind:'where',fieldPath:fieldPath,opStr:opStr,value:value}; }
    function orderBy(fieldPath,directionStr){ return {kind:'orderBy',fieldPath:fieldPath,directionStr:directionStr}; }
    function limit(value){ return {kind:'limit',value:value}; }
    function query(base){
      var constraints=[].slice.call(arguments,1);
      return constraints.reduce(function(current,constraint){
        if(!constraint) return current;
        if(constraint.kind==='where') return current.where(constraint.fieldPath,constraint.opStr,constraint.value);
        if(constraint.kind==='orderBy') return constraint.directionStr ? current.orderBy(constraint.fieldPath,constraint.directionStr) : current.orderBy(constraint.fieldPath);
        if(constraint.kind==='limit') return current.limit(constraint.value);
        return current;
      },base);
    }
    async function getCountFromServer(ref){ var snapshot=await ref.get(); return {data:function(){return {count:snapshot.size};}}; }
    function onSnapshot(ref,next,error,complete){
      if(isDocumentReference(ref)) return ref.onSnapshot(function(snapshot){ next(wrapDocumentSnapshot(snapshot)); },error,complete);
      return ref.onSnapshot(next,error,complete);
    }

    window.RebataTrackFirebaseCompat={initializeApp,getApps,getAuth,browserSessionPersistence,setPersistence,onAuthStateChanged,signOut,signInWithEmailAndPassword,signInWithCustomToken,sendPasswordResetEmail,getFirestore,doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,addDoc,serverTimestamp,deleteField,Timestamp,writeBatch,where,orderBy,limit,query,getCountFromServer,onSnapshot};

    var config=window.REBATIFY_FIREBASE_CONFIG||{};
    var settings=window.REBATIFY_BETA_SETTINGS||{};
    var required=['apiKey','authDomain','projectId','appId'];
    var missing=required.filter(function(k){ return !String(config[k]||'').trim(); });
    var firebaseConfigured=missing.length===0;
    var adminEmail=String(settings.adminEmail||'app.rebatatrack@yahoo.com').trim().toLowerCase();
    var adminEmails=Array.from(new Set([adminEmail].concat(Array.isArray(settings.adminEmails)?settings.adminEmails:[]).map(function(v){return String(v||'').trim().toLowerCase();}).filter(Boolean)));
    var emailAutomationEnabled=settings.emailAutomationEnabled===true;
    var testerPortalUrl=String(settings.testerPortalUrl||'https://rebatatrack.github.io/beta-login.html').trim();
    var app=null,auth=null,db=null,authPersistenceReady=Promise.resolve();
    if(firebaseConfigured){
      app=getApps().find(function(a){return a.name==='[DEFAULT]';})||initializeApp(config);
      auth=getAuth(app);
      authPersistenceReady=setPersistence(auth,browserSessionPersistence).catch(function(){});
      db=getFirestore(app);
    }
    function isAdminUser(user){ return !!user && adminEmails.indexOf(String(user.email||'').trim().toLowerCase())!==-1; }
    function timestampToDate(value){
      if(!value) return null;
      if(typeof value.toDate==='function') return value.toDate();
      if(value instanceof Date) return value;
      var d=new Date(value); return Number.isNaN(d.getTime())?null:d;
    }
    function timestampToIso(value){ var d=timestampToDate(value); return d?d.toISOString():''; }
    async function sha256Hex(text){
      var data=new TextEncoder().encode(String(text||''));
      var digest=await crypto.subtle.digest('SHA-256',data);
      return Array.from(new Uint8Array(digest),function(b){return b.toString(16).padStart(2,'0');}).join('');
    }
    function friendlyFirebaseError(error){
      var code=String(error&&error.code||'');
      var map={
        'auth/invalid-credential':'That email or password was not recognized.',
        'auth/invalid-login-credentials':'That email or password was not recognized.',
        'auth/user-disabled':'This account is currently disabled.',
        'auth/too-many-requests':'Too many attempts were made. Please wait a moment and try again.',
        'auth/email-already-in-use':'An authentication account already exists for this email address.',
        'auth/weak-password':'Please use a stronger password.',
        'auth/network-request-failed':'The connection could not be completed. Please check your connection and try again.',
        'auth/unauthorized-continue-uri':'The password email could not open the requested return page. Refresh the website and try again.',
        'permission-denied':'This action could not be completed because access is not permitted.',
        'failed-precondition':'This feature is not fully configured yet.',
        'rebatify/email-not-configured':'The RebataTrack email service has not been connected yet.',
        'rebatify/email-send-failed':'The RebataTrack invitation email could not be sent.',
        'rebatify/invite-expired':'This beta invitation has expired.',
        'rebatify/invite-invalid':'This beta invitation is invalid or has already been used.'
      };
      return map[code]||(error&&error.message?error.message:'Something went wrong. Please try again.');
    }
    window.RebataTrackFirebaseCore={firebaseConfigured:firebaseConfigured,firebaseMissingFields:missing,adminEmail:adminEmail,adminEmails:adminEmails,emailAutomationEnabled:emailAutomationEnabled,testerPortalUrl:testerPortalUrl,app:app,auth:auth,db:db,authPersistenceReady:authPersistenceReady,isAdminUser:isAdminUser,timestampToDate:timestampToDate,timestampToIso:timestampToIso,sha256Hex:sha256Hex,friendlyFirebaseError:friendlyFirebaseError};
    window.__REBATATRACK_FIREBASE_RUNTIME_READY=true;
  }catch(error){
    window.__REBATATRACK_FIREBASE_RUNTIME_READY=false;
    window.__REBATATRACK_FIREBASE_RUNTIME_ERROR=String(error&&error.message||error);
    if(window.__REBATIFY_ADMIN_BOOT) window.__REBATIFY_ADMIN_BOOT.lastError=window.__REBATATRACK_FIREBASE_RUNTIME_ERROR;
    console.error('RebataTrack Firebase runtime failed:',error);
  }
})();
