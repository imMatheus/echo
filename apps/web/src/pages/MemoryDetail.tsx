import { Link, useNavigate, useParams } from 'react-router-dom';
import { MemoryDetailView } from '@/components/MemoryDetailView';

export default function MemoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <MemoryDetailView
      id={id}
      onLeave={() => navigate('/memories')}
      backLink={
        <Link to="/memories" className="text-xs text-muted-foreground hover:text-foreground">
          ← Memories
        </Link>
      }
    />
  );
}
