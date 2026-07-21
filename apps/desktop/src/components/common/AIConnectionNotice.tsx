import { CircleAlert, Settings } from "lucide-react";
import { AI_UNAVAILABLE_HINT } from "../../lib/constants";

export function AIConnectionNotice({
  id,
  onOpenSettings,
}: {
  id: string;
  onOpenSettings: () => void;
}) {
  return (
    <div className="ai-connection-notice" id={id} role="note">
      <CircleAlert size={17} aria-hidden />
      <div>
        <strong>AI connection needed</strong>
        <span>{AI_UNAVAILABLE_HINT}.</span>
      </div>
      <button className="secondary-action" type="button" onClick={onOpenSettings}>
        <Settings size={15} aria-hidden />
        <span>Open AI Assistance</span>
      </button>
    </div>
  );
}
