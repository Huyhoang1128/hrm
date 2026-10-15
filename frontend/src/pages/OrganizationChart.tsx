import React, { useState, useEffect } from 'react';
import { departmentsAPI, employeesAPI, authAPI, Department, Employee } from '../utils/api';
import {
  BuildingOfficeIcon,
  UserIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  UsersIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  RectangleGroupIcon,
  Square3Stack3DIcon,
  EnvelopeIcon,
  PhoneIcon,
  StarIcon
} from '@heroicons/react/24/outline';
import { approvalService } from '../services/approval.service';

const cx = (...classes: any[]) => classes.filter(Boolean).join(' ');

/* ═══ UI Components ═══ */

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-600 border-emerald-100/50 shadow-[0_2px_10px_rgba(16,185,129,0.05)]',
    onboarding: 'bg-blue-50 text-blue-600 border-blue-100/50 shadow-[0_2px_10px_rgba(37,99,235,0.05)]',
    leave: 'bg-amber-50 text-amber-600 border-amber-100/50 shadow-[0_2px_10px_rgba(245,158,11,0.05)]',
    department: 'bg-indigo-50 text-indigo-600 border-indigo-100/50 shadow-[0_2px_10px_rgba(79,70,229,0.05)]',
  };

  const labels: Record<string, string> = {
    active: 'Trực thuộc',
    onboarding: 'Thử việc',
    leave: 'Nghỉ phép',
    department: 'Phòng ban',
  };

  return (
    <span className={cx(
      'px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all duration-300 hover:scale-105',
      styles[status] || styles.active
    )}>
      {labels[status] || status}
    </span>
  );
};

const StatCard: React.FC<{ label: string; value: string | number; color: 'indigo' | 'emerald' | 'violet' }> = ({ label, value, color }) => {
  const iconStyles = {
    indigo: 'from-indigo-500 to-indigo-600 shadow-indigo-200/50',
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-200/50',
    violet: 'from-violet-500 to-violet-600 shadow-violet-100/50',
  };

  return (
    <div className="group bg-white p-6 rounded-[2.5rem] shadow-[0_10px_40px_rgba(0,0,0,0.02)] flex items-center gap-6 border border-slate-100/80 transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_60px_rgba(0,0,0,0.06)] hover:border-white relative overflow-hidden animate-scale-up-sm">
      {/* Subtle background decoration */}
      <div className={cx('absolute -right-4 -bottom-4 w-24 h-24 bg-gradient-to-br opacity-[0.06] rounded-full blur-2xl transition-all duration-700 group-hover:scale-150', iconStyles[color].split(' ')[0])} />

      <div className={cx(
        'w-16 h-16 rounded-[1.25rem] flex items-center justify-center shadow-xl transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 bg-gradient-to-br text-white',
        iconStyles[color]
      )}>
        {label.includes('Phòng') ? <BuildingOfficeIcon className="w-8 h-8" /> :
          label.includes('Nhân') ? <UsersIcon className="w-8 h-8" /> :
            <ChartBarIcon className="w-8 h-8" />}
      </div>
      <div className="flex flex-col">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 opacity-80">{label}</p>
        <p className="text-3xl font-black text-slate-900 tracking-tighter leading-none animate-count-up transform-gpu">{value}</p>
      </div>
    </div>
  );
};

interface TreeNode {
  id: string; // Changed to string to support unique prefixes like 'dept-1' or 'emp-1'
  name: string;
  type: 'department' | 'employee';
  children: TreeNode[];
  data: Department | Employee;
  expanded?: boolean;
}

const OrganizationChart: React.FC = () => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'hierarchical' | 'flat'>('hierarchical');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    fetchOrganizationData();
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const fetchOrganizationData = async () => {
    try {
      setLoading(true);
      const [departmentsResponse, employeesResponse] = await Promise.all([
        departmentsAPI.list(),
        employeesAPI.list({ page_size: 1000 })
      ]);

      let departments = departmentsResponse.results;
      let employees = employeesResponse.results;

      const nodeMap = new Map<string, TreeNode>();
      const rootNodes: TreeNode[] = [];
      const deptManagerMap = new Map<number, number>();

      // 1. Create all nodes and map department managers
      departments.forEach(dept => {
        const nodeId = `dept-${dept.id}`;
        const node: TreeNode = {
          id: nodeId,
          name: dept.name,
          type: 'department',
          children: [],
          data: dept,
          expanded: true
        };
        nodeMap.set(nodeId, node);
        if (dept.manager) deptManagerMap.set(dept.id, dept.manager);
      });

      employees.forEach(emp => {
        const nodeId = `emp-${emp.id}`;
        const node: TreeNode = {
          id: nodeId,
          name: emp.full_name,
          type: 'employee',
          children: [],
          data: emp,
          expanded: true
        };
        nodeMap.set(nodeId, node);

        // Backup: If department manager is not set, identify it via position title
        if (emp.department?.id && !deptManagerMap.has(emp.department.id)) {
          const title = emp.position?.title?.toLowerCase() || '';
          if (emp.position?.is_management || title.includes('trưởng') || title.includes('giám đốc') || title.includes('head')) {
            deptManagerMap.set(emp.department.id, emp.id);
          }
        }
      });

      // 2. Build Department Hierarchy (Smart Matching)
      departments.forEach(dept => {
        const node = nodeMap.get(`dept-${dept.id}`)!;
        let parentNode: TreeNode | null = null;

        if (dept.parent_department && nodeMap.has(`dept-${dept.parent_department}`)) {
          const parentDeptNode = nodeMap.get(`dept-${dept.parent_department}`)!;
          const parentDeptHeadId = deptManagerMap.get(dept.parent_department);

          // If parent department has a Head, link this department under that Head
          if (parentDeptHeadId && nodeMap.has(`emp-${parentDeptHeadId}`)) {
            parentNode = nodeMap.get(`emp-${parentDeptHeadId}`)!;
          } else {
            parentNode = parentDeptNode;
          }
        }

        if (parentNode) {
          parentNode.children.push(node);
        } else {
          rootNodes.push(node);
        }
      });

      // 3. Build Employee Hierarchy (Smart Matching)
      employees.forEach(emp => {
        const node = nodeMap.get(`emp-${emp.id}`)!;
        let parentNode: TreeNode | null = null;

        // Match Rule 1: Direct Manager assigned in Employee profile
        if (emp.manager?.id && nodeMap.has(`emp-${emp.manager.id}`)) {
          parentNode = nodeMap.get(`emp-${emp.manager.id}`)!;
        }
        // Match Rule 2: If no direct manager, check if they belong to a department
        else if (emp.department?.id) {
          const deptHeadId = deptManagerMap.get(emp.department.id);

          // If this employee is NOT the Department Head, look for the Head
          if (deptHeadId && deptHeadId !== emp.id && nodeMap.has(`emp-${deptHeadId}`)) {
            parentNode = nodeMap.get(`emp-${deptHeadId}`)!;
          } else {
            // If they ARE the Department Head or no head exists, link to the Department Node
            if (nodeMap.has(`dept-${emp.department.id}`)) {
              parentNode = nodeMap.get(`dept-${emp.department.id}`)!;
            }
          }
        }

        // Assign to parent or root
        if (parentNode && parentNode.id !== node.id) {
          parentNode.children.push(node);
        } else if (!parentNode) {
          rootNodes.push(node);
        }
      });

      // 4. Final Sort: Managers first, then Departments, then Staff
      const sortNodes = (nodes: TreeNode[]) => {
        nodes.forEach(node => {
          if (node.children.length > 0) {
            node.children.sort((a, b) => {
              // Priority 1: Departments
              if (a.type === 'department' && b.type !== 'department') return -1;
              if (a.type !== 'department' && b.type === 'department') return 1;

              // Priority 2: Managers (is_management: true or is dept head)
              if (a.type === 'employee' && b.type === 'employee') {
                const aData = a.data as Employee;
                const bData = b.data as Employee;

                const aIsMgr = aData.position?.is_management || deptManagerMap.get(aData.department?.id || 0) === aData.id;
                const bIsMgr = bData.position?.is_management || deptManagerMap.get(bData.department?.id || 0) === bData.id;

                if (aData.is_senior_manager && !bData.is_senior_manager) return -1;
                if (!aData.is_senior_manager && bData.is_senior_manager) return 1;

                if (aIsMgr && !bIsMgr) return -1;
                if (!aIsMgr && bIsMgr) return 1;

                // Priority 3: Management Level (Higher level first)
                const aLevel = aData.management_level || 0;
                const bLevel = bData.management_level || 0;
                if (aLevel !== bLevel) return bLevel - aLevel;
              }

              return a.name.localeCompare(b.name);
            });
            sortNodes(node.children);
          }
        });
      };
      sortNodes(rootNodes);

      setTreeData(rootNodes);
      setError(null);
    } catch (err: any) {
      setError('Không thể tải dữ liệu tổ chức.');
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodeId: string, nodes: TreeNode[]): TreeNode[] => {
    return nodes.map(node => {
      // Unique matching logic with prefix-aware IDs
      if (node.id === nodeId && (node.type === 'department' || node.children.length > 0)) {
        return { ...node, expanded: !node.expanded };
      }
      if (node.children.length > 0) {
        return { ...node, children: toggleNode(nodeId, node.children) };
      }
      return node;
    });
  };

  const toggleAllNodes = (expand: boolean) => {
    const updateNodes = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(node => ({
        ...node,
        expanded: expand,
        children: updateNodes(node.children)
      }));
    };
    setTreeData(prev => updateNodes(prev));
  };

  const handleToggle = (nodeId: string) => {
    setTreeData(prev => toggleNode(nodeId, prev));
  };

  const checkMatch = (node: TreeNode, query: string): boolean => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    const matchName = node.name.toLowerCase().includes(lowerQuery);

    // Also match against employee ID if it's an employee node
    let matchId = false;
    if (node.type === 'employee') {
      const empData = node.data as Employee;
      matchId = empData.employee_id?.toLowerCase().includes(lowerQuery);
    }

    if (matchName || matchId) return true;
    return node.children.some(child => checkMatch(child, query));
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isDepartment = node.type === 'department';
    const hasChildren = node.children.length > 0;

    // Auto-expand if searching and recursive match found
    const hasSearchMatch = searchQuery ? checkMatch(node, searchQuery) : true;
    if (!hasSearchMatch) return null;

    const lowerQuery = searchQuery.toLowerCase();
    const isDirectMatch = searchQuery && (
      node.name.toLowerCase().includes(lowerQuery) ||
      (node.type === 'employee' && (node.data as Employee).employee_id?.toLowerCase().includes(lowerQuery))
    );

    const isExpanded = searchQuery ? hasSearchMatch : node.expanded;
    const empData = !isDepartment ? (node.data as Employee) : null;

    // Responsive Indentation Strategy
    const baseIndent = isMobile ? 12 : 32;
    const stepIndent = isMobile ? 8 : 20;
    const indentSize = depth === 0 ? 0 : (depth === 1 ? baseIndent : baseIndent + (depth - 1) * stepIndent);

    // Position connector line
    const connectorLeft = depth === 0 ? 0 : (depth === 1 ? (baseIndent / 2) : baseIndent + (depth - 2) * stepIndent + (stepIndent / 2));

    return (
      <div key={`${node.type}-${node.id}`} className="relative shrink-0 w-fit min-w-full">
        {/* Hierarchy Line Vertical - Thinner & More Subtle */}
        {depth > 0 && (
          <div
            className="absolute top-[-14px] bottom-0 w-[1.5px] bg-slate-200/80"
            style={{ left: `${connectorLeft}px`, height: 'calc(100% + 14px)' }}
          />
        )}

        <div
          className={cx(
            'group relative flex items-center p-3 sm:p-4 rounded-[1.25rem] sm:rounded-[1.5rem] transition-all duration-500 mb-2 sm:mb-3 border w-fit min-w-[260px] sm:min-w-[340px] max-w-none shadow-sm',
            'animate-fade-in-up',
            depth < 8 ? `stagger-${depth + 1}` : 'stagger-8',
            searchQuery && !isDirectMatch ? 'opacity-40 grayscale-[0.2]' : 'opacity-100',
            isDepartment
              ? (isDirectMatch
                ? 'bg-white shadow-xl border-indigo-500 ring-4 ring-indigo-500/10 animate-glow-pulse'
                : 'bg-white/80 border-slate-100 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-100/20')
              : cx(
                isDirectMatch
                  ? 'bg-white border-indigo-600 shadow-2xl shadow-indigo-100 ring-4 ring-indigo-600/20 z-10 animate-glow-pulse'
                  : (empData?.is_senior_manager ? 'bg-white border-amber-200 shadow-amber-50 shadow-md' : 'bg-white border-transparent hover:border-slate-200 hover:shadow-md')
              )
          )}
          style={{ marginLeft: `${indentSize}px` }}
          onClick={() => (isDepartment || hasChildren) && handleToggle(node.id)}
        >
          {/* Hierarchy Line Horizontal - Professional Curved look simulation */}
          {depth > 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-[1.5px] bg-slate-200/80 rounded-full"
              style={{ left: `-${indentSize - connectorLeft}px`, width: `${indentSize - connectorLeft}px` }}
            />
          )}

          <div className="flex items-center flex-1 min-w-0">
            {(isDepartment || hasChildren) && (
              <div className="mr-3 shrink-0">
                {hasChildren ? (
                  <div className={cx(
                    "w-7 h-7 rounded-xl flex items-center justify-center transition-all duration-500",
                    isExpanded ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200 rotate-0" : "bg-white text-slate-400 border border-slate-100 group-hover:bg-indigo-50 group-hover:text-indigo-600 -rotate-90"
                  )}>
                    {isExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                  </div>
                ) : (
                  isDepartment ? <div className="w-7" /> : null
                )}
              </div>
            )}

            <div className={cx(
              "p-2 sm:p-3 rounded-xl sm:rounded-2xl shrink-0 mr-3 sm:mr-4 shadow-sm transform transition-all duration-500 group-hover:scale-110",
              isDepartment ? "bg-indigo-50 text-indigo-600" : "bg-slate-50 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white"
            )}>
              {isDepartment ? <BuildingOfficeIcon className="w-5 h-5 sm:w-6 sm:h-6" /> : <UserIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
            </div>

            <div className="min-w-0 pr-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                <p className={cx(
                  "tracking-tight leading-tight break-words transition-colors duration-300",
                  isDepartment ? "text-base md:text-lg font-black text-slate-900 uppercase" : "text-[15px] font-bold text-slate-700 group-hover:text-indigo-600"
                )}>
                  {node.name}
                </p>
                {!isDepartment && empData?.is_senior_manager && (
                  <span className="shrink-0 w-fit px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[9px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm animate-pulse">
                    <StarIcon className="w-3 h-3" />
                    Manager
                  </span>
                )}
              </div>
              <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1 sm:mt-1.5 leading-none opacity-80 group-hover:opacity-100 transition-opacity">
                {isDepartment
                  ? `${node.children.filter(c => c.type === 'employee').length} Nhân sự`
                  : empData?.position?.title || 'Chuyên viên'}
              </p>
            </div>
          </div>

          {!isDepartment && empData && (
            <div className="hidden lg:flex items-center gap-4 px-4 border-l border-slate-100 ml-4 shrink-0 justify-center">
              <div className="text-right">
                <p className="text-xs font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 group-hover:bg-indigo-50 group-hover:text-indigo-500 transition-all duration-300">{empData.employee_id}</p>
              </div>
              <StatusBadge status={
                empData.employment_status === 'ACTIVE' ? 'active' :
                  empData.employment_status === 'PROBATION' ? 'onboarding' :
                    empData.employment_status === 'INACTIVE' ? 'leave' : 'active'
              } />
            </div>
          )}
        </div>

        {isExpanded && hasChildren && (
          <div className="animate-slide-down transform-gpu origin-top">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderFlatView = () => {
    const allEmployees: TreeNode[] = [];
    const collectEmployees = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.type === 'employee') allEmployees.push(node);
        if (node.children.length > 0) collectEmployees(node.children);
      });
    };
    collectEmployees(treeData);

    const filteredEmployees = allEmployees.filter(emp => {
      const lowerQuery = searchQuery.toLowerCase();
      const empData = emp.data as Employee;
      return emp.name.toLowerCase().includes(lowerQuery) ||
        empData.employee_id?.toLowerCase().includes(lowerQuery);
    });

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {filteredEmployees.map((employee, index) => {
          const empData = employee.data as Employee;
          return (
            <div
              key={`employee-${employee.id}`}
              className={cx(
                "group bg-white p-4 sm:p-6 rounded-[2.25rem] sm:rounded-[2.5rem] border border-slate-100/80 hover:border-indigo-400 hover:shadow-[0_25px_60px_rgba(79,70,229,0.06)] transition-all duration-700 relative overflow-hidden flex flex-col h-full",
                "animate-fade-in-up",
                index < 12 ? `stagger-${(index % 8) + 1}` : 'stagger-8'
              )}
            >
              {/* Identity Header */}
              <div className="flex items-center justify-between mb-4 border-b border-slate-50 pb-3">
                <span className="text-[10px] font-black text-indigo-400 bg-indigo-50/50 px-2 py-0.5 rounded-md border border-indigo-100/50 uppercase tracking-widest">
                  #{empData.employee_id}
                </span>
                <StatusBadge status={
                  empData.employment_status === 'ACTIVE' ? 'active' :
                    empData.employment_status === 'PROBATION' ? 'onboarding' :
                      empData.employment_status === 'INACTIVE' ? 'leave' : 'active'
                } />
              </div>

              <div className="flex items-center gap-4 mb-6">
                <div className="relative shrink-0">
                  <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center group-hover:bg-indigo-600 transition-all duration-500 shadow-inner group-hover:rotate-3">
                    <UserIcon className="w-7 h-7 sm:w-10 sm:h-10 text-slate-200 group-hover:text-white" />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-lg sm:text-xl font-black text-slate-800 break-words group-hover:text-indigo-600 transition-colors leading-tight mb-1 uppercase tracking-tight">
                    {employee.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {empData.position?.title || 'Chuyên viên'}
                    </p>
                    {empData.is_senior_manager && <StarIcon className="w-3 h-3 text-amber-400 fill-amber-400" />}
                  </div>
                </div>
              </div>

              {/* Minimalist Info Section */}
              <div className="space-y-2 mt-auto">
                <div className="flex items-center gap-3 py-1.5 px-3 bg-slate-50/50 rounded-lg border border-slate-100/50">
                  <BuildingOfficeIcon className="w-3.5 h-3.5 text-indigo-400" />
                  <div className="min-w-0 flex-1 flex flex-col justify-center">
                    <p className="text-[11px] font-bold text-slate-700 truncate">
                      {empData.department?.name || 'Văn phòng Công ty'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1">
                  <div className="flex items-center gap-3 px-3 py-1 group/info">
                    <EnvelopeIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                      <p className="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate group-hover/info:text-emerald-700 transition-colors">
                        {empData.personal_email || empData.user?.email || 'N/A'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 px-3 py-1 group/info">
                    <PhoneIcon className="w-3.5 h-3.5 text-blue-400" />
                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                      <p className="text-[10px] sm:text-[11px] font-bold text-slate-500 truncate group-hover/info:text-blue-700 transition-colors">
                        {empData.phone_number || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin shadow-lg mb-6"></div>
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm animate-pulse">Khởi tạo dữ liệu tổ chức...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 selection:bg-indigo-100 overflow-x-hidden p-6 md:p-10 lg:p-12 relative">
      {/* Background blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-indigo-50/50 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-violet-50/50 blur-[120px] rounded-full" />
      </div>

      {/* Page Header - Tối ưu Responsive & Premium UI */}
      <div className="mb-12 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Premium Icon Container with Glow Effect */}
          <div className="relative group cursor-pointer" onClick={() => window.location.reload()}>
            <div className="absolute -inset-1 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-[22px] blur opacity-25 group-hover:opacity-60 transition duration-1000 group-hover:duration-300"></div>
            <div className="relative w-16 h-16 rounded-3xl bg-white shadow-[0_20px_50px_rgba(79,70,229,0.15)] flex items-center justify-center border border-white backdrop-blur-xl transition-all duration-500 group-hover:scale-105 group-hover:-translate-y-1">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 flex items-center justify-center shadow-lg transform transition-transform duration-700 group-hover:rotate-12">
                <RectangleGroupIcon className="w-7 h-7 text-white" />
              </div>
            </div>
          </div>

          <div>
            <h1 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tighter uppercase transition-all duration-300">
              SƠ ĐỒ <span className="text-indigo-600">TỔ CHỨC</span>
            </h1>
            <p className="text-slate-500 font-medium max-w-md leading-relaxed text-sm md:text-base">
              Quản lý cấu trúc nhân sự và phân cấp phòng ban toàn hệ thống một cách trực quan.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full lg:w-auto">
          <div className="relative w-full sm:w-[320px] group/search">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="w-5 h-5 text-slate-300 group-focus-within/search:text-indigo-500 transition-colors" />
            </div>
            <input
              type="text"
              placeholder="Mã NV, tên nhân sự..."
              className="w-full pl-12 pr-6 py-4 rounded-2xl bg-white border border-slate-100 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm hover:shadow-md"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* View Mode Switcher */}

          <div className="flex p-1.5 bg-slate-100/70 backdrop-blur-md rounded-2xl shadow-inner w-full sm:w-auto border border-white/50">
            <button
              onClick={() => setViewMode('hierarchical')}
              className={cx(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all duration-300",
                viewMode === 'hierarchical' ? "bg-white text-indigo-600 shadow-lg scale-100" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <Squares2X2Icon className="w-4 h-4" />
              <span className="hidden sm:inline">Dạng cây</span>
              <span className="sm:hidden text-[10px]">Cây</span>
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={cx(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all duration-300",
                viewMode === 'flat' ? "bg-white text-indigo-600 shadow-lg scale-100" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <ListBulletIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Danh sách</span>
              <span className="sm:hidden text-[10px]">List</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* Main View Container */}
        <div className="bg-white/40 backdrop-blur-xl rounded-[2.5rem] border border-white p-8 md:p-12 shadow-2xl shadow-slate-200/40">
          {treeData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-24 h-24 rounded-3xl bg-slate-50 flex items-center justify-center mb-8">
                <BuildingOfficeIcon className="w-12 h-12 text-slate-200" />
              </div>
              <p className="text-xl font-black text-slate-800">Dữ liệu trống</p>
              <p className="text-slate-400 font-medium">Hệ thống chưa ghi nhận cấu trúc tổ chức nào.</p>
            </div>
          ) : viewMode === 'hierarchical' ? (
            <div className="space-y-4">
              {/* Tree Controls Toolbar - Contextual Placement */}
              <div className="flex items-center justify-between mb-2 px-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Cấu trúc hiển thị</span>
                </div>
                <div className="flex bg-white/50 backdrop-blur-sm p-1 rounded-xl border border-slate-100 shadow-sm">
                  <button
                    onClick={() => toggleAllNodes(true)}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"
                    title="Mở tất cả"
                  >
                    <ArrowsPointingOutIcon className="w-6 h-6" />
                  </button>
                  <div className="w-px h-4 bg-slate-100 self-center mx-1" />
                  <button
                    onClick={() => toggleAllNodes(false)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-all"
                    title="Thu gọn tất cả"
                  >
                    <ArrowsPointingInIcon className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto custom-scrollbar pb-4 -mx-4 sm:mx-0 px-4 sm:px-0">
                <div className="space-y-4 min-w-max pr-8">
                  {treeData.map(node => renderTreeNode(node))}
                </div>
              </div>
            </div>
          ) : (
            renderFlatView()
          )}
        </div>

        {/* Statistics Section */}
        <div className="space-y-6">
          <div className="flex items-center gap-4 ml-2">
            <div className="w-12 h-12 rounded-2xl bg-white shadow-lg border border-slate-100 flex items-center justify-center">
              <ChartBarIcon className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Số liệu tổng quan</h2>
              <p className="text-xs font-bold text-slate-400 leading-none mt-0.5 italic">Cập nhật thời gian thực</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              label="Tổng số phòng ban"
              value={treeData.filter(node => node.type === 'department').length}
              color="indigo"
            />
            <StatCard
              label="Tổng nhân sự toàn cục"
              value={(() => {
                let count = 0;
                const countEmployees = (nodes: TreeNode[]) => {
                  nodes.forEach(node => {
                    if (node.type === 'employee') count++;
                    if (node.children.length > 0) countEmployees(node.children);
                  });
                };
                countEmployees(treeData);
                return count;
              })()}
              color="emerald"
            />
            <StatCard
              label="Cấp độ tổ chức"
              value={(() => {
                let maxDepth = 0;
                const calculateDepth = (nodes: TreeNode[], depth: number) => {
                  nodes.forEach(node => {
                    maxDepth = Math.max(maxDepth, depth);
                    if (node.children.length > 0) calculateDepth(node.children, depth + 1);
                  });
                };
                calculateDepth(treeData, 1);
                return maxDepth;
              })()}
              color="violet"
            />
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(15px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes scale-up-sm {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px -5px rgba(79, 70, 229, 0.1); }
          50% { box-shadow: 0 0 40px 2px rgba(79, 70, 229, 0.2); }
        }

        @keyframes count-up {
          from { opacity: 0; transform: scale(0.9); filter: blur(4px); }
          to { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        
        .animate-fade-in-up { animation: fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-scale-up-sm { animation: scale-up-sm 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-slide-down { animation: slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-glow-pulse { animation: glow-pulse 3s infinite ease-in-out; }
        .animate-count-up { animation: count-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }

        .stagger-1 { animation-delay: 40ms; }
        .stagger-2 { animation-delay: 80ms; }
        .stagger-3 { animation-delay: 120ms; }
        .stagger-4 { animation-delay: 160ms; }
        .stagger-5 { animation-delay: 200ms; }
        .stagger-6 { animation-delay: 240ms; }
        .stagger-7 { animation-delay: 280ms; }
        .stagger-8 { animation-delay: 320ms; }

        .glass-panel {
          background: rgba(255, 255, 255, 0.4);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </div>
  );
};

export default OrganizationChart;
