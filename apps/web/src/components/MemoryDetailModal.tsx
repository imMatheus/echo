import { XIcon } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { MemoryDetailView } from '@/components/MemoryDetailView';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';

/**
 * A memory's detail shown as a modal over the list it was opened from. The list
 * is the history entry beneath this one (see MemoryCard's `background` state),
 * so closing simply pops back to it; a direct visit to the URL falls back to the
 * full page (App renders this modal only when a background location is present).
 */
export default function MemoryDetailModal() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const close = () => {
    if (location.key === 'default') navigate('/memories');
    else navigate(-1);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="flex w-[calc(100%-2rem)] max-w-2xl flex-col gap-4 sm:max-w-2xl">
        <DialogTitle className="sr-only">Memory</DialogTitle>
        <MemoryDetailView
          id={id}
          onLeave={close}
          trailing={
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon />
            </DialogClose>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
