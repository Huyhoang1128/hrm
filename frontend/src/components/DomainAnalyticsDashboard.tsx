import { useState, useEffect } from 'react';
import {
  ChartBarIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  TagIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
} from '@heroicons/react/24/outline';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart,
} from 'recharts';
import { Domain, domainsAPI } from '@/utils/api';

interface DomainAnalyticsProps {
  chatbotId: string;
}

interface DomainMetrics {
  domainId: string;
  domainName: string;
  totalDocuments: number;
  totalSearches: number;
  averageRelevanceScore: number;
  detectionAccuracy: number;
  searchSuccessRate: number;
  topKeywords: string[];
  recentActivity: {
    date: string;
    searches: number;
    accuracy: number;
  }[];
}

interface SearchAnalytics {
  totalSearches: number;
  domainDetectionRate: number;
  averageResponseTime: number;
  topDomains: {
    domain: string;
    searches: number;
    percentage: number;
  }[];
  searchTrends: {
    date: string;
    total: number;
    withDomain: number;
    withoutDomain: number;
  }[];
}

const COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#06B6D4',
];

export default function DomainAnalyticsDashboard({
  chatbotId,
}: DomainAnalyticsProps) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainMetrics, setDomainMetrics] = useState<DomainMetrics[]>([]);
  const [searchAnalytics, setSearchAnalytics] =
    useState<SearchAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTimeRange, setSelectedTimeRange] = useState<
    '7d' | '30d' | '90d'
  >('30d');

  useEffect(() => {
    fetchAnalyticsData();
  }, [chatbotId, selectedTimeRange]);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      setError('');

      // Fetch domains
      const domainsResponse = await domainsAPI.list({ chatbotId });
      setDomains(domainsResponse.domains);

      // Mock analytics data - in real implementation, this would come from analytics API
      const mockDomainMetrics: DomainMetrics[] = domainsResponse.domains.map(
        (domain, index) => ({
          domainId: domain.id,
          domainName: domain.name,
          totalDocuments: Math.floor(Math.random() * 50) + 10,
          totalSearches: Math.floor(Math.random() * 1000) + 100,
          averageRelevanceScore: Math.random() * 0.4 + 0.6, // 0.6 - 1.0
          detectionAccuracy: Math.random() * 0.3 + 0.7, // 0.7 - 1.0
          searchSuccessRate: Math.random() * 0.2 + 0.8, // 0.8 - 1.0
          topKeywords: [
            `keyword${index + 1}`,
            `term${index + 1}`,
            `phrase${index + 1}`,
          ],
          recentActivity: Array.from({ length: 7 }, (_, i) => ({
            date: new Date(Date.now() - i * 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0],
            searches: Math.floor(Math.random() * 50) + 10,
            accuracy: Math.random() * 0.3 + 0.7,
          })).reverse(),
        })
      );

      const mockSearchAnalytics: SearchAnalytics = {
        totalSearches: mockDomainMetrics.reduce(
          (sum, m) => sum + m.totalSearches,
          0
        ),
        domainDetectionRate: 0.85,
        averageResponseTime: 150 + Math.random() * 100,
        topDomains: mockDomainMetrics
          .sort((a, b) => b.totalSearches - a.totalSearches)
          .slice(0, 5)
          .map((m, index) => ({
            domain: m.domainName,
            searches: m.totalSearches,
            percentage:
              (m.totalSearches /
                mockDomainMetrics.reduce(
                  (sum, metric) => sum + metric.totalSearches,
                  0
                )) *
              100,
          })),
        searchTrends: Array.from({ length: 30 }, (_, i) => {
          const total = Math.floor(Math.random() * 100) + 50;
          const withDomain = Math.floor(total * (0.7 + Math.random() * 0.2));
          return {
            date: new Date(Date.now() - i * 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0],
            total,
            withDomain,
            withoutDomain: total - withDomain,
          };
        }).reverse(),
      };

      setDomainMetrics(mockDomainMetrics);
      setSearchAnalytics(mockSearchAnalytics);
    } catch (error) {
      console.error('Failed to fetch analytics data:', error);
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatNumber = (value: number) => value.toLocaleString();

  const getScoreColor = (score: number) => {
    if (score >= 0.9) return 'text-green-600';
    if (score >= 0.8) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreIcon = (score: number) => {
    if (score >= 0.9)
      return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
    if (score >= 0.8)
      return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />;
    return <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Domain Analytics</h2>
          <p className="text-sm text-gray-500">
            Monitor domain performance and search analytics
          </p>
        </div>
        <div>
          <select
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value as any)}
            className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Overview Cards */}
      {searchAnalytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <MagnifyingGlassIcon className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">
                  Total Searches
                </p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatNumber(searchAnalytics.totalSearches)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TagIcon className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">
                  Domain Detection Rate
                </p>
                <p className="text-2xl font-semibold text-gray-900">
                  {formatPercentage(searchAnalytics.domainDetectionRate)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DocumentTextIcon className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">
                  Active Domains
                </p>
                <p className="text-2xl font-semibold text-gray-900">
                  {domains.filter((d) => d.isActive).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ChartBarIcon className="h-8 w-8 text-orange-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">
                  Avg Response Time
                </p>
                <p className="text-2xl font-semibold text-gray-900">
                  {Math.round(searchAnalytics.averageResponseTime)}ms
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Trends Chart */}
      {searchAnalytics && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Search Trends
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={searchAnalytics.searchTrends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <YAxis />
              <Tooltip
                labelFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="withDomain"
                stackId="1"
                stroke="#3B82F6"
                fill="#3B82F6"
                name="With Domain Detection"
              />
              <Area
                type="monotone"
                dataKey="withoutDomain"
                stackId="1"
                stroke="#EF4444"
                fill="#EF4444"
                name="Without Domain Detection"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Domains by Search Volume */}
        {searchAnalytics && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Top Domains by Search Volume
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={searchAnalytics.topDomains}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ domain, percentage }) =>
                    `${domain} (${percentage.toFixed(1)}%)`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="searches"
                >
                  {searchAnalytics.topDomains.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Domain Performance Metrics */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Domain Performance
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={domainMetrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="domainName" />
              <YAxis />
              <Tooltip formatter={(value: number) => formatPercentage(value)} />
              <Legend />
              <Bar
                dataKey="detectionAccuracy"
                fill="#10B981"
                name="Detection Accuracy"
              />
              <Bar
                dataKey="averageRelevanceScore"
                fill="#3B82F6"
                name="Avg Relevance Score"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Domain Details Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            Domain Performance Details
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Domain
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Documents
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Searches
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Detection Accuracy
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Relevance Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Success Rate
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {domainMetrics.map((metric) => (
                <tr key={metric.domainId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <TagIcon className="h-5 w-5 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {metric.domainName}
                        </div>
                        <div className="text-sm text-gray-500">
                          Keywords: {metric.topKeywords.slice(0, 2).join(', ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatNumber(metric.totalDocuments)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatNumber(metric.totalSearches)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getScoreIcon(metric.detectionAccuracy)}
                      <span
                        className={`ml-2 text-sm font-medium ${getScoreColor(metric.detectionAccuracy)}`}
                      >
                        {formatPercentage(metric.detectionAccuracy)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getScoreIcon(metric.averageRelevanceScore)}
                      <span
                        className={`ml-2 text-sm font-medium ${getScoreColor(metric.averageRelevanceScore)}`}
                      >
                        {formatPercentage(metric.averageRelevanceScore)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getScoreIcon(metric.searchSuccessRate)}
                      <span
                        className={`ml-2 text-sm font-medium ${getScoreColor(metric.searchSuccessRate)}`}
                      >
                        {formatPercentage(metric.searchSuccessRate)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {metric.detectionAccuracy >= 0.9 &&
                      metric.averageRelevanceScore >= 0.9 ? (
                        <div className="flex items-center text-green-600">
                          <ArrowTrendingUpIcon className="h-4 w-4 mr-1" />
                          <span className="text-sm font-medium">Excellent</span>
                        </div>
                      ) : metric.detectionAccuracy >= 0.8 &&
                        metric.averageRelevanceScore >= 0.8 ? (
                        <div className="flex items-center text-yellow-600">
                          <span className="text-sm font-medium">Good</span>
                        </div>
                      ) : (
                        <div className="flex items-center text-red-600">
                          <ArrowTrendingDownIcon className="h-4 w-4 mr-1" />
                          <span className="text-sm font-medium">
                            Needs Attention
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity Timeline */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Domain Activity Timeline
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {domainMetrics.slice(0, 2).map((metric) => (
            <div key={metric.domainId}>
              <h4 className="text-md font-medium text-gray-700 mb-3">
                {metric.domainName}
              </h4>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={metric.recentActivity}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) =>
                      new Date(value).toLocaleDateString()
                    }
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString()
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="searches"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    name="Searches"
                  />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke="#10B981"
                    strokeWidth={2}
                    name="Accuracy"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
