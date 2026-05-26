Jurion — Landing page (lista para subir)
=========================================

Carpeta canónica del repositorio: edita y sube SOLO este directorio.

Contenido:
  index.html          Página principal (inicio del sitio estático)
  landing-assets/     Capturas de pantalla (PNG)
  README.txt          Este archivo

Cómo publicar
-------------
1. Sube TODO el contenido de landingPage/ al hosting (FTP, cPanel, Netlify, GitHub Pages, etc.).
2. Mantén la estructura: index.html y landing-assets/ en el mismo nivel.
3. El dominio debe servir index.html como página de inicio.

Vista local
-----------
Desde esta carpeta:
  npx serve .

Luego abre en el navegador la URL que indique (ej. http://localhost:3000 o :8080) + /index.html

O abre directamente index.html en Chrome (doble clic).

Con el servidor del proyecto (npm run dev):
  http://localhost:3000/landingPage/index.html

Notas
-----
- Fuentes Inter desde Google Fonts (requiere internet).
- HTML estático: no hace falta build.
- No edites la copia en la raíz del repo (landing.html); la versión oficial vive aquí.
