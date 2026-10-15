import { useState, useRef, useEffect } from 'react';
import { CloudArrowUpIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { mediaAPI, Media } from '@/utils/api';

interface MediaUploaderProps {
  chatbotId: string;
  onMediaChanges?: (changes: { toUpload: File[]; toDelete: string[] }) => void;
  maxFiles?: number;
  className?: string;
}

export default function MediaUploader({
  chatbotId,
  onMediaChanges,
  className = '',
}: MediaUploaderProps) {
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [mediaToDelete, setMediaToDelete] = useState<string[]>([]);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchExistingMedia = async () => {
      try {
        const media = await mediaAPI.getChatbotMedia(chatbotId);
        setExistingMedia(media);
      } catch (err) {
        console.error('Failed to fetch existing media:', err);
      }
    };

    if (chatbotId) {
      fetchExistingMedia();
    }
  }, [chatbotId]);

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setError('');
    const newFiles = Array.from(files);
    const updatedFiles = [...filesToUpload, ...newFiles];
    setFilesToUpload(updatedFiles);

    // Notify parent component of changes
    onMediaChanges?.({
      toUpload: updatedFiles,
      toDelete: mediaToDelete,
    });
  };

  const handleRemoveExistingMedia = (mediaId: string) => {
    const newMediaToDelete = [...mediaToDelete, mediaId];
    setMediaToDelete(newMediaToDelete);
    setExistingMedia(existingMedia.filter((m) => m.id !== mediaId));

    // Notify parent component of changes
    onMediaChanges?.({
      toUpload: filesToUpload,
      toDelete: newMediaToDelete,
    });
  };

  const handleRemoveFileToUpload = (index: number) => {
    const newFiles = filesToUpload.filter((_, i) => i !== index);
    setFilesToUpload(newFiles);
    setExistingMedia(existingMedia);

    // Notify parent component of changes
    onMediaChanges?.({
      toUpload: newFiles,
      toDelete: mediaToDelete,
    });
  };

  const getMediaUrl = (media: Media) => {
    return `${import.meta.env.VITE_MANAGEMENT_API_URL}/${media.filePath}`;
  };

  const getFilePreviewUrl = (file: File) => {
    return URL.createObjectURL(file);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Media Library
        </label>
        <p className="text-sm text-gray-500 mb-3">
          Upload images to add to your chatbot's media library
        </p>
      </div>

      {/* Upload Area */}
      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />

        <div className="flex flex-col items-center">
          <CloudArrowUpIcon className="h-8 w-8 text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">
            Click to select images or drag and drop
          </p>
          <p className="text-xs text-gray-500 mt-1">
            PNG, JPG, GIF, WebP up to 50MB
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Files to Upload Preview */}
      {filesToUpload.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Files to Upload ({filesToUpload.length})
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filesToUpload.map((file, index) => (
              <div key={index} className="relative group">
                <img
                  src={getFilePreviewUrl(file)}
                  alt={file.name}
                  className="w-full h-20 object-cover rounded-lg border border-gray-200"
                />
                <div
                  onClick={() => handleRemoveFileToUpload(index)}
                  className="absolute -top-2 -right-2 cursor-pointer bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <XMarkIcon className="h-4 w-4" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-blue-600 bg-opacity-90 text-white text-xs p-1 rounded-b-lg">
                  {file.name.length > 15
                    ? file.name.substring(0, 15) + '...'
                    : file.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing Media */}
      {existingMedia.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Existing Images ({existingMedia.length})
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {existingMedia.map((media) => {
              const isMarkedForDeletion = mediaToDelete.includes(media.id);
              if (isMarkedForDeletion) return null;

              return (
                <div
                  key={media.id}
                  className={`relative group ${isMarkedForDeletion ? 'opacity-50' : ''}`}
                >
                  <img
                    src={getMediaUrl(media)}
                    alt={media.originalName}
                    className="w-full h-20 object-cover rounded-lg border border-gray-200"
                  />
                  <div
                    onClick={() => handleRemoveExistingMedia(media.id)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white cursor-pointer rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </div>
                  <div
                    className={`absolute bottom-0 left-0 right-0 text-white text-xs p-1 rounded-b-lg bg-black bg-opacity-50`}
                  >
                    {media.originalName.length > 15
                      ? media.originalName.substring(0, 15) + '...'
                      : media.originalName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
