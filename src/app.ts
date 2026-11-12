import express from 'express';

export const app = express();
// Dietro il reverse proxy req.ip deve essere quello dell'utente, non del proxy.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
