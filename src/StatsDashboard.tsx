import React, { useState, useEffect, Fragment } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { User } from 'firebase/auth';
import { BarChart2, Activity, Clock, FileText, RefreshCw, XCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

interface AiEvent {
  id: string;
  timestamp: any;
  userId: string;
  userEmail: string;
  feature: string;
  subMode: string;
  model: string;
  promptTokens: number;
  responseTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  inputLength: number;
}

type DateRange = 'Today' | 'Last 7 days' | 'Last 30 days' | 'All time';

export function StatsDashboard({ user }: { user: User }) {
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateRange>('All time');
  const [error, setError] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [tableLimit, setTableLimit] = useState(20);

  useEffect(() => {
    fetchStats();
  }, [user, dateFilter]);

  const fetchStats = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      let startTime = null;
      if (dateFilter === 'Today') {
        startTime = new Date(now.setHours(0,0,0,0));
      } else if (dateFilter === 'Last 7 days') {
        startTime = new Date();
        startTime.setDate(startTime.getDate() - 7);
      } else if (dateFilter === 'Last 30 days') {
        startTime = new Date();
        startTime.setDate(startTime.getDate() - 30);
      }

      let constraints: any[] = [
        limit(500)
      ];

      if (startTime) {
        constraints = [
          where("timestamp", ">=", startTime),
          limit(500)
        ];
      }

      let q = query(collection(db, "users", user.uid, "ai_events"), ...constraints);
      
      const snap = await getDocs(q);
      const fetched: AiEvent[] = [];
      snap.forEach(doc => {
        fetched.push({ id: doc.id, ...doc.data() } as AiEvent);
      });
      // Sort locally: reverse chronological
      fetched.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
        return timeB - timeA;
      });
      setEvents(fetched);
    } catch (err) {
      console.error("Failed to fetch stats", err);
      setError("Failed to load analytics data: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const now = new Date();
  
  const filteredEvents = events;

  if (loading && events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <Activity size={32} className="animate-spin mb-4 text-primary" />
        <p>Loading analytics...</p>
      </div>
    );
  }

  if (!loading && events.length === 0 && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 bg-white rounded-3xl border border-gray-100 shadow-sm mx-auto max-w-2xl mt-12">
        <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
          <BarChart2 size={32} className="text-gray-400" />
        </div>
        <h3 className="text-lg font-bold text-gray-700 mb-2">No AI calls logged yet.</h3>
        <p className="text-sm">Use any feature to see your analytics here.</p>
        <button onClick={fetchStats} className="mt-6 px-6 py-2 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-2">
          <RefreshCw size={16} /> Refresh Page
        </button>
      </div>
    );
  }

  // Calculate stats based on filteredEvents
  const totalCalls = filteredEvents.length;
  const successCalls = filteredEvents.filter(e => e.success).length;
  const successRate = totalCalls > 0 ? (successCalls / totalCalls) * 100 : 0;
  
  const avgLatency = totalCalls > 0 
    ? (filteredEvents.reduce((acc, e) => acc + (e.latencyMs || 0), 0) / totalCalls) 
    : 0;

  const totalTokens = filteredEvents.reduce((acc, e) => acc + (e.promptTokens || 0) + (e.responseTokens || 0), 0);
  
  const formatTokens = (t: number) => {
    if (t >= 1000000) return (t / 1000000).toFixed(1) + 'M';
    if (t >= 1000) return (t / 1000).toFixed(1) + 'k';
    return t.toString();
  };

  const getSuccessColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600';
    if (rate >= 80) return 'text-amber-500';
    return 'text-red-500';
  };

  // Section 2: Feature Breakdown
  const featureCounts: Record<string, number> = {
    'meeting_summariser': 0,
    'email_drafter': 0,
    'document_qa': 0,
    'prompt_library': 0
  };
  filteredEvents.forEach(e => {
    if (featureCounts[e.feature] !== undefined) {
      featureCounts[e.feature]++;
    } else {
      featureCounts[e.feature] = 1;
    }
  });

  const featureLabels: Record<string, string> = {
    'meeting_summariser': 'Meeting Summariser',
    'email_drafter': 'Email Drafter',
    'document_qa': 'Document Q&A',
    'prompt_library': 'Prompt Library'
  };

  // Section 3: Daily Activity
  const last14Days = Array.from({length: 14}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    d.setHours(0,0,0,0);
    return d;
  });

  const dailyCounts = last14Days.map(date => {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const count = filteredEvents.filter(e => {
      if (!e.timestamp?.toDate) return false;
      const t = e.timestamp.toDate().getTime();
      return t >= date.getTime() && t < nextDay.getTime();
    }).length;
    return {
      date,
      label: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
      count
    };
  });
  const maxDaily = Math.max(...dailyCounts.map(d => d.count), 1);

  // Section 4: Latency Distribution
  let fast = 0, normal = 0, slow = 0;
  filteredEvents.forEach(e => {
    if ((e.latencyMs || 0) < 1000) fast++;
    else if (e.latencyMs <= 3000) normal++;
    else slow++;
  });

  // Table Data
  const recentEvents = filteredEvents.slice(0, tableLimit);

  const getRelativeTime = (timestamp: any) => {
    if (!timestamp?.toDate) return "Just now";
    const diffMs = now.getTime() - timestamp.toDate().getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} hours ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays === 1) return `Yesterday`;
    return `${diffDays} days ago`;
  };

  const getFeatureColours = (f: string) => {
     switch (f) {
       case 'meeting_summariser': return 'bg-purple-100 text-purple-800 border-purple-200';
       case 'email_drafter': return 'bg-blue-100 text-blue-800 border-blue-200';
       case 'document_qa': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
       default: return 'bg-green-100 text-green-800 border-green-200';
     }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-6xl mx-auto space-y-8"
    >
      {/* SECTION 6: FILTERS */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {(['Today', 'Last 7 days', 'Last 30 days', 'All time'] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setDateFilter(r)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                dateFilter === r ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <button 
          onClick={fetchStats}
          className="p-2 text-gray-400 hover:text-primary transition-colors bg-gray-50 hover:bg-green-50 rounded-lg flex items-center justify-center gap-2"
          disabled={loading}
        >
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          <span className="text-sm font-semibold sm:hidden">Refresh</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm border border-red-100">
          {error}
        </div>
      )}

      {/* SECTION 1: SUMMARY ROW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="text-gray-400 uppercase tracking-wider text-xs font-bold mb-2 flex items-center gap-2">
            <Activity size={16} /> Total AI Calls
          </div>
          <div className="text-3xl font-black text-dark-accent mt-auto">{totalCalls.toLocaleString()}</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="text-gray-400 uppercase tracking-wider text-xs font-bold mb-2 flex items-center gap-2">
            <CheckCircle2 size={16} /> Success Rate
          </div>
          <div className={`text-3xl font-black mt-auto ${getSuccessColor(successRate)}`}>
            {successRate.toFixed(1)}%
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="text-gray-400 uppercase tracking-wider text-xs font-bold mb-2 flex items-center gap-2">
            <Clock size={16} /> Avg Latency
          </div>
          <div className="text-3xl font-black text-dark-accent mt-auto">
            {(avgLatency / 1000).toFixed(1)}s
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="text-gray-400 uppercase tracking-wider text-xs font-bold mb-2 flex items-center gap-2">
            <FileText size={16} /> Est. Tokens Used
          </div>
          <div className="text-3xl font-black text-dark-accent mt-auto">
            {formatTokens(totalTokens)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* SECTION 2: FEATURE BREAKDOWN */}
        <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-bold text-gray-800 mb-6">Feature Breakdown</h3>
          <div className="space-y-4">
            {Object.entries(featureCounts).sort((a,b)=>b[1]-a[1]).map(([feat, count], i) => {
              const pct = totalCalls > 0 ? (count / totalCalls) * 100 : 0;
              const opacity = 1 - (i * 0.2); // varies opacity for primary colour
              return (
                <div key={feat} className="space-y-1">
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-gray-700">{featureLabels[feat] || feat}</span>
                    <span className="text-gray-500">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-1000 bg-primary"
                      style={{ width: `${pct}%`, opacity: opacity > 0.3 ? opacity : 0.3 }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* SECTION 4: LATENCY DISTRIBUTION */}
        <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="text-lg font-bold text-gray-800 mb-6">Latency Distribution</h3>
          <div className="space-y-6 mt-2">
            {[
              { label: 'Fast (<1000ms)', count: fast, color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
              { label: 'Normal (1000–3000ms)', count: normal, color: 'bg-amber-400', text: 'text-amber-700', bg: 'bg-amber-50' },
              { label: 'Slow (>3000ms)', count: slow, color: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' }
            ].map(bucket => {
              const pct = totalCalls > 0 ? (bucket.count / totalCalls) * 100 : 0;
              return (
                <div key={bucket.label} className="space-y-2">
                  <div className="flex justify-between items-center text-sm font-bold">
                    <div className={`px-3 py-1 rounded-full ${bucket.text} ${bucket.bg}`}>
                      {bucket.label}
                    </div>
                    <span className="text-gray-600">{bucket.count}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-grow bg-gray-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${bucket.color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 font-bold w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECTION 3: DAILY ACTIVITY */}
      <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-8">Daily Activity (Last 14 Days)</h3>
        <div className="flex items-end justify-between h-48 gap-1 sm:gap-2">
          {dailyCounts.map((d, i) => {
            const heightPct = (d.count / maxDaily) * 100;
            return (
              <div key={i} className="flex flex-col items-center flex-1 h-full group relative">
                {/* Tooltip */}
                <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-gray-800 text-white text-xs py-1 px-2 rounded pointer-events-none transition-opacity whitespace-nowrap z-10">
                  {d.count} calls
                </div>
                
                {/* 0 label for empty days */}
                {d.count === 0 && (
                  <div className="text-[10px] text-gray-400 font-bold mb-1">0</div>
                )}
                
                {/* Bar */}
                <div className="w-full flex-grow flex items-end justify-center rounded-t-sm">
                   <div 
                     className="w-full sm:w-4/5 bg-primary/20 group-hover:bg-primary transition-colors rounded-t-sm min-h-[4px]"
                     style={{ height: `${heightPct}%`, display: d.count === 0 ? 'none' : 'block' }}
                   />
                </div>
                
                {/* Label */}
                <div className="mt-3 text-[10px] sm:text-xs font-bold text-gray-400 rotate-45 sm:rotate-0 origin-left sm:origin-center whitespace-nowrap h-8">
                  {d.label.replace(',', '')}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex justify-between text-xs text-gray-400 uppercase font-bold tracking-wider opacity-60">
           <span>{dailyCounts[0].date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}</span>
           <span>{dailyCounts[dailyCounts.length-1].date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>

      {/* SECTION 5: RECENT CALLS TABLE */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-12">
         <div className="p-6 border-b border-gray-100">
           <h3 className="text-lg font-bold text-gray-800">Recent Calls</h3>
         </div>
         <div className="overflow-x-auto">
           <table className="w-full text-sm text-left">
             <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
               <tr>
                 <th className="px-6 py-4">Time</th>
                 <th className="px-6 py-4">Feature</th>
                 <th className="px-6 py-4">Sub-Mode</th>
                 <th className="px-6 py-4">Latency</th>
                 <th className="px-6 py-4">Tokens</th>
                 <th className="px-6 py-4">Status</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-gray-100">
               {recentEvents.map(e => (
                 <Fragment key={e.id}>
                 <tr 
                   className={`hover:bg-gray-50 transition-colors ${e.errorMessage ? 'cursor-pointer' : ''}`}
                   onClick={() => e.errorMessage && setExpandedErrorId(expandedErrorId === e.id ? null : e.id)}
                 >
                   <td className="px-6 py-4 font-medium text-gray-600 whitespace-nowrap">{getRelativeTime(e.timestamp)}</td>
                   <td className="px-6 py-4">
                     <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest border ${getFeatureColours(e.feature)}`}>
                       {featureLabels[e.feature] || e.feature}
                     </span>
                   </td>
                   <td className="px-6 py-4 text-gray-600">{e.subMode}</td>
                   <td className="px-6 py-4 text-gray-600">{(e.latencyMs / 1000).toFixed(1)}s</td>
                   <td className="px-6 py-4 text-gray-600">{((e.promptTokens||0) + (e.responseTokens||0))}</td>
                   <td className="px-6 py-4 font-bold">
                     {e.success ? (
                       <span className="text-green-600 flex items-center gap-1"><CheckCircle2 size={14}/> OK</span>
                     ) : (
                       <span className="text-red-500 flex items-center gap-1"><XCircle size={14} /> Error</span>
                     )}
                   </td>
                 </tr>
                 {expandedErrorId === e.id && e.errorMessage && (
                   <tr>
                     <td colSpan={6} className="px-6 py-4 bg-red-50/50 border-t-0">
                       <div className="text-xs font-mono text-red-600 break-words whitespace-pre-wrap">
                         {e.errorMessage}
                       </div>
                     </td>
                   </tr>
                 )}
                 </Fragment>
               ))}
               {recentEvents.length === 0 && (
                 <tr>
                   <td colSpan={6} className="px-6 py-8 text-center text-gray-400">No recent calls to show.</td>
                 </tr>
               )}
             </tbody>
           </table>
         </div>
         {tableLimit < filteredEvents.length && (
           <div className="p-4 border-t border-gray-100 text-center bg-gray-50/50">
             <button 
               onClick={() => setTableLimit(l => l + 20)}
               className="px-6 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-bold rounded-lg hover:border-gray-300 hover:text-gray-800 transition-colors shadow-sm"
             >
               Load More ({filteredEvents.length - tableLimit} remaining)
             </button>
           </div>
         )}
      </div>
    </motion.div>
  );
}
