import express from 'express';
import multer from 'multer';

/**
 * Rutas bajo el prefijo `/api/precedents` (montar con `app.use('/api/precedents', …)`).
 */
export function createPrecedentsFileRouter(
  upload: ReturnType<typeof multer>,
  indexFromFileHandler: express.RequestHandler
): express.Router {
  const router = express.Router();
  router.post('/index-from-file', upload.single('archivo'), indexFromFileHandler);
  return router;
}
