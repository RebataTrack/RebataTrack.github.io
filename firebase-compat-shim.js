// RebataTrack Website Build 127 Firebase compatibility bridge.
// Uses the classic Firebase compat SDK loaded by the page and exposes the
// modular-style helpers used by the existing Beta/Admin source files.

function fb() {
  const value = window.firebase;
  if (!value) throw new Error('Firebase compatibility SDK did not load.');
  return value;
}

export function initializeApp(config) {
  const firebase = fb();
  return firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
}

export function getApps() {
  const firebase = fb();
  return firebase.apps || [];
}

export function getAuth(app) {
  if (app && typeof app.auth === 'function') return app.auth();
  return fb().auth();
}

export const browserSessionPersistence = window.firebase?.auth?.Auth?.Persistence?.SESSION || 'session';

export function setPersistence(auth, persistence) {
  return auth.setPersistence(persistence);
}

export function onAuthStateChanged(auth, next, error, complete) {
  return auth.onAuthStateChanged(next, error, complete);
}

export function signOut(auth) {
  return auth.signOut();
}

export function signInWithEmailAndPassword(auth, email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}

export function signInWithCustomToken(auth, token) {
  return auth.signInWithCustomToken(token);
}

export function sendPasswordResetEmail(auth, email, actionCodeSettings) {
  return auth.sendPasswordResetEmail(email, actionCodeSettings);
}

export function getFirestore(app) {
  if (app && typeof app.firestore === 'function') return app.firestore();
  return fb().firestore();
}

function isDocumentReference(ref) {
  return !!ref && typeof ref.set === 'function' && typeof ref.get === 'function';
}

function wrapDocumentSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  return {
    id: snapshot.id,
    ref: snapshot.ref,
    metadata: snapshot.metadata,
    exists: () => !!snapshot.exists,
    data: (...args) => snapshot.data(...args),
    get: (...args) => snapshot.get(...args)
  };
}

export function doc(parent, ...segments) {
  if (!parent || typeof parent.doc !== 'function') throw new Error('Invalid Firestore document parent.');
  if (!segments.length) return parent.doc();
  return parent.doc(segments.map(String).join('/'));
}

export function collection(parent, ...segments) {
  if (!parent || typeof parent.collection !== 'function') throw new Error('Invalid Firestore collection parent.');
  return parent.collection(segments.map(String).join('/'));
}

export function getDoc(ref) {
  return ref.get().then(wrapDocumentSnapshot);
}

export function getDocs(ref) {
  return ref.get();
}

export function setDoc(ref, data, options) {
  return options ? ref.set(data, options) : ref.set(data);
}

export function updateDoc(ref, data) {
  return ref.update(data);
}

export function deleteDoc(ref) {
  return ref.delete();
}

export function addDoc(ref, data) {
  return ref.add(data);
}

export function serverTimestamp() {
  return fb().firestore.FieldValue.serverTimestamp();
}

export function deleteField() {
  return fb().firestore.FieldValue.delete();
}

export const Timestamp = window.firebase?.firestore?.Timestamp;

export function writeBatch(db) {
  return db.batch();
}

export function where(fieldPath, opStr, value) {
  return { kind: 'where', fieldPath, opStr, value };
}

export function orderBy(fieldPath, directionStr) {
  return { kind: 'orderBy', fieldPath, directionStr };
}

export function limit(value) {
  return { kind: 'limit', value };
}

export function query(base, ...constraints) {
  return constraints.reduce((current, constraint) => {
    if (!constraint) return current;
    if (constraint.kind === 'where') return current.where(constraint.fieldPath, constraint.opStr, constraint.value);
    if (constraint.kind === 'orderBy') return constraint.directionStr ? current.orderBy(constraint.fieldPath, constraint.directionStr) : current.orderBy(constraint.fieldPath);
    if (constraint.kind === 'limit') return current.limit(constraint.value);
    return current;
  }, base);
}

export async function getCountFromServer(ref) {
  const snapshot = await ref.get();
  return { data: () => ({ count: snapshot.size }) };
}

export function onSnapshot(ref, next, error, complete) {
  if (isDocumentReference(ref)) {
    return ref.onSnapshot(snapshot => next(wrapDocumentSnapshot(snapshot)), error, complete);
  }
  return ref.onSnapshot(next, error, complete);
}
