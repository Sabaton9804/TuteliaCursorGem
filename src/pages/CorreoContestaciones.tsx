import { CorreoReviewQueue } from './CorreoPendientes';

export default function CorreoContestaciones() {
  return (
    <CorreoReviewQueue
      queueFilter="contestaciones"
      pageTitle="Contestaciones pendientes"
      pageSubtitle="Respuestas de entidades accionadas al buzón del juzgado. Revise, apruebe el ingreso al expediente y tipifique como acto procesal."
    />
  );
}
