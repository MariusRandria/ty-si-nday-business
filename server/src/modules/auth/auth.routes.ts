import { Router } from 'express';
import multer from 'multer';
import {
  activate,
  changePassword,
  googleAuth,
  login,
  register,
  resendRegistrationOtp,
  uploadProfilePhoto,
  verifyRegistrationOtp,
} from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';

export const authRouter = Router();
const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Le fichier doit être une image JPEG, PNG ou WebP.'));
      return;
    }
    callback(null, true);
  },
}).single('photo');

function parseProfilePhoto(request: Parameters<typeof profilePhotoUpload>[0], response: Parameters<typeof profilePhotoUpload>[1], next: Parameters<typeof profilePhotoUpload>[2]) {
  profilePhotoUpload(request, response, (error: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'La photo ne doit pas dépasser 5 Mo.' });
      return;
    }
    response.status(400).json({ error: error instanceof Error ? error.message : 'Impossible de lire la photo envoyée.' });
  });
}

authRouter.post('/login', login);
authRouter.post('/register', register);
authRouter.post('/register/verify', verifyRegistrationOtp);
authRouter.post('/register/resend', resendRegistrationOtp);
authRouter.post('/google', googleAuth);
authRouter.post('/activate', activate);
authRouter.post('/password/change', requireAuth, changePassword);
authRouter.post('/profile/photo', requireAuth, parseProfilePhoto, uploadProfilePhoto);
