import React, { useState } from 'react';
import {
  CheckCircleIcon,
  ClockIcon,
  PlayIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import onboardingService from '../services/onboarding.service';

// ============================================
// TYPE DEFINITIONS
// ============================================

type ChecklistItem = {
  id: number;
  title: string;
  description: string;
  order: number;
  is_completed: boolean;
  is_required: boolean;
  completed_at: string | null;
  completed_by: number | null;
  completed_by_name: string | null;
};

type OnboardingTask = {
  id: number;
  name: string;
  description: string;
  task_type: string;
  task_code: string | null;
  order: number;
  deadline: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  assigned_to: number | null;
  assigned_to_name: string | null;
  completion_note: string;
  attachment: string | null;
  started_at: string | null;
  completed_at: string | null;
  is_overdue: boolean;
  days_until_deadline: number | null;
  checklist_items: ChecklistItem[];
};

type TasksSectionProps = {
  tasks: OnboardingTask[];
  onboardingId: number;
  onUpdate: () => void;
  canCompleteTask?: (task: OnboardingTask) => { allowed: boolean; reason?: string };
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const showError = (msg: string) => window.alert(msg);
const showSuccess = (msg: string) => window.alert(msg);

const getTaskTypeLabel = (type: string) => {
  const types: Record<string, string> = {
    DOCUMENT: 'Tiếp nhận hồ sơ',
    CONTRACT: 'Ký hợp đồng',
    TRAINING: 'Đào tạo',
    IT_SETUP: 'Thiết lập IT',
    ORIENTATION: 'Hướng dẫn',
    EVALUATION: 'Đánh giá',
    OTHER: 'Khác',
  };
  return types[type] || type;
};

const getStatusBadge = (status: string, isOverdue: boolean) => {
  if (status === 'COMPLETED') {
    return (
      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium flex items-center">
        <CheckCircleIcon className="w-4 h-4 mr-1" />
        Hoàn thành
      </span>
    );
  }
  if (status === 'SKIPPED') {
    return (
      <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-medium flex items-center">
        <XMarkIcon className="w-4 h-4 mr-1" />
        Đã bỏ qua
      </span>
    );
  }
  if (status === 'IN_PROGRESS') {
    return (
      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium flex items-center">
        <ClockIcon className="w-4 h-4 mr-1" />
        Đang thực hiện
      </span>
    );
  }
  if (isOverdue) {
    return (
      <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium flex items-center">
        <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
        Quá hạn
      </span>
    );
  }
  return (
    <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
      Chờ xử lý
    </span>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

const TasksSection: React.FC<TasksSectionProps> = ({ tasks, onUpdate, canCompleteTask }) => {
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<OnboardingTask | null>(null);

  // ============================================
  // API CALLS
  // ============================================

  const handleStartTask = async (taskId: number) => {
    try {
      await onboardingService.startTask(taskId);
      showSuccess('Đã bắt đầu task');
      onUpdate();
    } catch (error: any) {
      console.error('START TASK ERROR:', error);
      showError(error.response?.data?.message || 'Không thể bắt đầu task');
    }
  };

  const handleCompleteTask = async () => {
    if (!selectedTask) return;

    try {
      await onboardingService.completeTask(selectedTask.id, completionNote);
      showSuccess('Đã hoàn thành task');
      setShowCompleteModal(false);
      setCompletionNote('');
      setSelectedTask(null);
      onUpdate();
    } catch (error: any) {
      console.error('COMPLETE TASK ERROR:', error);
      showError(error.response?.data?.message || 'Không thể hoàn thành task');
    }
  };

  const handleToggleChecklist = async (checklistId: number) => {
    try {
      await onboardingService.toggleChecklist(checklistId);
      onUpdate();
    } catch (error: any) {
      console.error('TOGGLE CHECKLIST ERROR:', error);
      showError(error.response?.data?.message || 'Không thể cập nhật checklist');
    }
  };

  // ============================================
  // RENDER
  // ============================================

  const renderTaskActions = (task: OnboardingTask) => {
    if (task.status === 'COMPLETED' || task.status === 'SKIPPED') {
      return null;
    }

    return (
      <div className="flex gap-2 flex-wrap">
        {task.status === 'PENDING' && (
          <button
            onClick={() => handleStartTask(task.id)}
            className="flex items-center whitespace-nowrap px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-md hover:bg-blue-100"
          >
            <PlayIcon className="w-4 h-4 mr-1" />
            Bắt đầu
          </button>
        )}

        {(task.status === 'IN_PROGRESS' || task.status === 'PENDING') && (() => {
          const guard = canCompleteTask ? canCompleteTask(task) : { allowed: true };
          return (
            <button
              onClick={() => {
                if (!guard.allowed) return;
                setSelectedTask(task);
                setShowCompleteModal(true);
              }}
              disabled={!guard.allowed}
              title={!guard.allowed ? guard.reason : ''}
              className={`flex items-center whitespace-nowrap px-3 py-1.5 rounded-md border ${
                !guard.allowed
                  ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
              }`}
            >
              <CheckCircleIcon className="w-4 h-4 mr-1" />
              Hoàn thành
            </button>
          );
        })()}
      </div>
    );
  };

  const renderChecklist = (task: OnboardingTask) => {
    if (!task.checklist_items || task.checklist_items.length === 0) {
      return null;
    }

    return (
      <div className="mt-4 pl-4 border-l-2 border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Checklist:</h4>
        <div className="space-y-2">
          {task.checklist_items.map((item) => (
            <div key={item.id} className="flex items-start">
              <input
                type="checkbox"
                checked={item.is_completed}
                onChange={() => handleToggleChecklist(item.id)}
                className="mt-1 mr-3 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div className="flex-1">
                <p
                  className={`text-sm ${item.is_completed ? 'line-through text-gray-500' : 'text-gray-900'
                    }`}
                >
                  {item.title}
                  {item.is_required && <span className="text-red-500 ml-1">*</span>}
                </p>
                {item.description && (
                  <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <ClockIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-500">Chưa có task nào</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tasks.map((task) => (
        <div key={task.id} className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 p-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() =>
                      setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                    }
                    className="text-gray-400 hover:text-gray-600"
                  >
                    {expandedTaskId === task.id ? (
                      <ChevronUpIcon className="w-5 h-5" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5" />
                    )}
                  </button>
                  <div>
                    <h3 className="font-medium text-gray-900">{task.name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-gray-500">
                        {getTaskTypeLabel(task.task_type)}
                      </span>
                      {task.deadline && (
                        <span className="text-xs text-gray-500">
                          • Hạn: {task.deadline}
                          {task.days_until_deadline !== null && (
                            <span
                              className={
                                task.days_until_deadline < 0
                                  ? 'text-red-600 font-medium'
                                  : task.days_until_deadline <= 3
                                    ? 'text-yellow-600 font-medium'
                                    : ''
                              }
                            >
                              {' '}
                              ({task.days_until_deadline > 0 ? 'Còn' : 'Quá'}{' '}
                              {Math.abs(task.days_until_deadline)} ngày)
                            </span>
                          )}
                        </span>
                      )}
                      {task.assigned_to_name && (
                        <span className="text-xs text-gray-500">
                          • Phụ trách: {task.assigned_to_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {getStatusBadge(task.status, task.is_overdue)}
                {renderTaskActions(task)}
              </div>
            </div>
          </div>

          {expandedTaskId === task.id && (
            <div className="p-4 bg-white border-t">
              {task.description && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Mô tả:</h4>
                  <p className="text-sm text-gray-600">{task.description}</p>
                </div>
              )}

              {task.task_type !== 'DOCUMENT' && renderChecklist(task)}

              {task.completion_note && (
                <div className="mt-4 p-3 bg-green-50 rounded-md">
                  <h4 className="text-sm font-medium text-green-900 mb-1">Ghi chú hoàn thành:</h4>
                  <p className="text-sm text-green-700">{task.completion_note}</p>
                </div>
              )}

              {task.completed_at && (
                <div className="mt-2 text-xs text-gray-500">
                  Hoàn thành lúc: {new Date(task.completed_at).toLocaleString('vi-VN')}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Complete Task Modal */}
      {showCompleteModal && selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-white w-full max-w-md rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Hoàn thành task</h3>
            <p className="text-gray-600 mb-4">
              Bạn có chắc muốn hoàn thành task <strong>{selectedTask.name}</strong>?
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Ghi chú (tùy chọn)</label>
              <textarea
                className="w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
                placeholder="Nhập ghi chú về task này..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCompleteModal(false);
                  setCompletionNote('');
                  setSelectedTask(null);
                }}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={handleCompleteTask}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Xác nhận hoàn thành
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TasksSection;