import { useState } from "react";

interface UploadFormProps {
  disabled: boolean;
  onSubmit: (payload: { name: string; file: File }) => Promise<void> | void;
}

export function UploadForm({ disabled, onSubmit }: UploadFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Entry name is required.");
      return;
    }
    if (!file) {
      setError("Select an audio file.");
      return;
    }

    await onSubmit({ name: trimmedName, file });
    setName("");
    setFile(null);
    const input = event.currentTarget.elements.namedItem("audioFile") as HTMLInputElement | null;
    if (input) {
      input.value = "";
    }
  };

  return (
    <form className="panel upload-form" onSubmit={handleSubmit}>
      <h2>Add Audio Entry</h2>
      <label>
        Entry Name
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My track"
          disabled={disabled}
        />
      </label>
      <label>
        Audio File
        <input
          name="audioFile"
          type="file"
          accept="audio/*"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={disabled}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={disabled}>
        {disabled ? "Processing..." : "Extract Beat Data"}
      </button>
    </form>
  );
}
