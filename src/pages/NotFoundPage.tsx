import { ArrowLeft, Map } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";

export function NotFoundPage() {
  return (
    <section className="page page--not-found">
      <EmptyState
        icon={<Map size={22} />}
        title="This view isn’t available"
        description="The address does not match an AXIS workspace. Return home to continue."
        action={
          <Link className="button button--primary button--medium" to="/">
            <ArrowLeft size={15} aria-hidden="true" />
            <span className="button__label">Return home</span>
          </Link>
        }
      />
    </section>
  );
}
