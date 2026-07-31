import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 

const Statistics = () => {
  const [stats, setStats] = useState({
    totalAttempts: 0,
    avgScore: 0,
    highestScore: 0,
    overallAccuracy: 0,
    brainAttempted: 0,
    brainAccuracy: 0,
    savedQsCount: 0,
    docsCount: 0,
    aiTestsCount: 0,
    flatTestsCount: 0,
    historyLog: []
  });

  useEffect(() => {
    const loadStatisticsFromCloud = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // 1. Fetch live submitted exams from cloud database
        const { data: sessions, error: sError } = await supabase
          .from('test_sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'submitted')
          .order('created_at', { ascending: false });

        // 2. Fetch total count of saved questions from the shared cloud pool
        const savedRes = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/pool/saved-questions?studentId=${user.id}`);
        const savedData = await savedRes.json();
        const qCount = savedData.success ? savedData.count : 0;

        // 3. FETCH BOTH METRICS BOXES DIRECTLY FROM THE PROFILES TABLE ROW
        const { data: profile } = await supabase
          .from('profiles')
          .select('brainfeed_count, brainfeed_accuracy')
          .eq('id', user.id)
          .single();

        const savedDocs = JSON.parse(localStorage.getItem('infinity_docs')) || [];

        let totalScoreSum = 0;
        let totalAccuracySum = 0;
        let peakScore = 0;
        let aiCount = 0;
        let flatCount = 0;
        let historyLogList = [];

        if (!sError && sessions) {
          sessions.forEach(run => {
            const score = parseFloat(run.score) || 0;
            totalScoreSum += score;
            if (score > peakScore) peakScore = score;

            const accPct = parseInt(run.accuracy) || 0;
            totalAccuracySum += accPct;

            const tId = String(run.test_id || '');
            if (tId.startsWith('INF-AI') || tId.startsWith('ai_') || tId.startsWith('AI-')) {
              aiCount++;
            } else {
              flatCount++;
            }

            if (historyLogList.length < 5) {
              historyLogList.push({
                attemptId: run.id,
                title: run.title,
                date: new Date(run.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                score: score,
                accuracy: run.accuracy || "0%"
              });
            }
          });
        }

        const totalCount = sessions ? sessions.length : 0;
        setStats({
          totalAttempts: totalCount,
          avgScore: totalCount > 0 ? (totalScoreSum / totalCount) : 0,
          highestScore: peakScore,
          overallAccuracy: totalCount > 0 ? Math.round(totalAccuracySum / totalCount) : 0,
          brainAttempted: profile?.brainfeed_count || 0,
          brainAccuracy: profile?.brainfeed_accuracy || 0,
          savedQsCount: qCount || 0,
          docsCount: savedDocs.length,
          aiTestsCount: aiCount,
          flatTestsCount: flatCount,
          historyLog: historyLogList
        });

      } catch (err) {
        console.error("Analytics syncing error:", err);
      }
    };

    loadStatisticsFromCloud();
  }, []);

  const aiRatioWidth = stats.totalAttempts > 0 ? (stats.aiTestsCount / stats.totalAttempts) * 100 : 0;
  const flatRatioWidth = stats.totalAttempts > 0 ? (stats.flatTestsCount / stats.totalAttempts) * 100 : 0;

  return (
    <div style={containerStyle} className="stat-container">
      <style>{`
        @media (max-width: 768px) {
          .content-view { padding-left: 0 !important; padding-right: 0 !important; }
          .stat-container { padding: 10px 6px !important; }
          .stat-header { margin-bottom: 14px !important; padding: 0 4px !important; }
          .stat-header h1 { font-size: 1.3rem !important; }
          .stat-header p { font-size: 0.72rem !important; margin-top: 2px !important; }
          .stat-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; margin-bottom: 12px !important; }
          .stat-card { padding: 12px 10px !important; border-radius: 12px !important; }
          .stat-card-label { font-size: 0.58rem !important; margin-bottom: 4px !important; }
          .stat-card-metric { font-size: 1.15rem !important; }
          .stat-card-sub { font-size: 0.6rem !important; margin-top: 4px !important; }
          .stat-split-grid { grid-template-columns: 1fr !important; gap: 10px !important; }
          .stat-large-card { padding: 14px !important; border-radius: 14px !important; }
          .stat-section-heading { font-size: 0.95rem !important; }
          .stat-section-sub { font-size: 0.68rem !important; margin-bottom: 14px !important; }
        }
      `}</style>
      <header className="stat-header" style={{ marginBottom: '35px' }}>
        <h1 style={{ fontSize: '2.4rem', fontWeight: '900', color: '#1e293b', margin: 0 }}>Precision Analytics</h1>
        <p style={{ color: '#64748b', marginTop: '5px', fontWeight: '500' }}>Bhai, ye raha tera live learning index aur productivity footprint:</p>
      </header>

      <div style={statsGrid} className="stat-grid">
        <div className="stat-card" style={{ ...cardStyle, background: 'linear-gradient(135deg, #000000, #475569)', color: '#fff', border: 'none' }}>
          <span className="stat-card-label" style={{ ...cardLabel, color: '#cbd5e1' }}>BrainFeed Practice</span>
          <h2 className="stat-card-metric" style={cardMetric}>Fed {stats.brainAttempted} Times</h2>
          <p className="stat-card-sub" style={{ ...cardSubText, color: '#cbd5e1' }}>Accuracy index: <b>{stats.brainAccuracy}%</b></p>
        </div>

        <div className="stat-card" style={{ ...cardStyle, borderTop: '6px solid #000000' }}>
          <span className="stat-card-label" style={cardLabel}>Total Test Runs</span>
          <h2 className="stat-card-metric" style={cardMetric}>{stats.totalAttempts}</h2>
          <p className="stat-card-sub" style={cardSubText}>Mock exams executed</p>
        </div>

        <div className="stat-card" style={{ ...cardStyle, borderTop: '6px solid #475569' }}>
          <span className="stat-card-label" style={cardLabel}>Mean Test Score</span>
          <h2 className="stat-card-metric" style={cardMetric}>{stats.avgScore.toFixed(2)}<span style={{ fontSize: '0.9rem', color: '#64748b' }}> M</span></h2>
          <p className="stat-card-sub" style={cardSubText}>Average yield across sessions</p>
        </div>

        <div className="stat-card" style={{ ...cardStyle, borderTop: '6px solid #94a3b8' }}>
          <span className="stat-card-label" style={cardLabel}>Peak Mock Score</span>
          <h2 className="stat-card-metric" style={cardMetric}>{stats.highestScore.toFixed(2)}<span style={{ fontSize: '0.9rem', color: '#64748b' }}> M</span></h2>
          <p className="stat-card-sub" style={cardSubText}>Highest score registered</p>
        </div>
      </div>

      <div style={splitLayoutGrid} className="stat-split-grid">
        <div style={largeCardBase} className="stat-large-card">
          <h3 className="stat-section-heading" style={sectionHeading}>Platform Intelligence Split</h3>
          <p className="stat-section-sub" style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '25px', fontWeight: '500' }}>
            Tracking engagement ratios between autonomous AI Labs vs static papers.
          </p>

          <div style={{ marginBottom: '25px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.88rem', fontWeight: 'bold' }}>
              <span style={{ color: '#000000' }}>AI Generated Laboratory Sessions</span>
              <span>{stats.aiTestsCount} Tests ({Math.round(aiRatioWidth)}%)</span>
            </div>
            <div style={progressBarContainer}>
              <div style={{ ...progressBarFill, width: `${aiRatioWidth}%`, background: '#000000' }}></div>
            </div>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.88rem', fontWeight: 'bold' }}>
              <span style={{ color: '#475569' }}>Standard Reference Full Mocks</span>
              <span>{stats.flatTestsCount} Tests ({Math.round(flatRatioWidth)}%)</span>
            </div>
            <div style={progressBarContainer}>
              <div style={{ ...progressBarFill, width: `${flatRatioWidth}%`, background: '#475569' }}></div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
            <div style={{ flex: 1, background: '#f8fafc', padding: '15px', borderRadius: '14px', textAlign: 'center' }}>
              <h4 style={{ margin: '5px 0 2px 0', color: '#1e293b', fontWeight: '800' }}>{stats.docsCount} Items</h4>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>LIBRARY DOSSIERS</p>
            </div>
            <div style={{ flex: 1, background: '#f8fafc', padding: '15px', borderRadius: '14px', textAlign: 'center' }}>
              <h4 style={{ margin: '5px 0 2px 0', color: '#1e293b', fontWeight: '800' }}>{stats.savedQsCount} Qs</h4>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>SAVED QUESTION VAULT</p>
            </div>
          </div>
        </div>

        <div style={largeCardBase} className="stat-large-card">
          <h3 className="stat-section-heading" style={sectionHeading}>Recent Performance Velocity</h3>
          <p className="stat-section-sub" style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '20px', fontWeight: '500' }}>
            Chronological growth curve mapping your last 5 examination runs.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {stats.historyLog.length > 0 ? (
              stats.historyLog.map((run, idx) => (
                <div key={run.attemptId || idx} style={timelineRow}>
                  <div style={timelineBullet}></div>
                  <div style={{ flex: 1, marginLeft: '12px' }}>
                    <h5 style={{ margin: 0, color: '#1e293b', fontSize: '0.9rem', fontWeight: '800' }}>{run.title}</h5>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'bold' }}>Attempted: {run.date}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', fontSize: '0.95rem', fontWeight: '900', color: '#1e293b' }}>
                      {parseFloat(run.score).toFixed(2)} M
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#000000', fontWeight: 'bold', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                      {run.accuracy}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem', fontWeight: '600' }}>
                Bhai, abhi tak koi test complete nahi hua hai. Ek baar paper launch karo fir velocity chart active hoga!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Styles Schemas
const containerStyle = { padding: '20px 30px', maxWidth: '1150px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }; const statsGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '25px', marginBottom: '35px' }; const cardStyle = { background: 'white', padding: '25px 20px', borderRadius: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.01)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }; const cardLabel = { fontSize: '0.72rem', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }; const cardMetric = { margin: 0, fontSize: '1.8rem', fontWeight: '900', color: '#1e293b', lineHeight: '1.2' }; const cardSubText = { margin: '8px 0 0 0', fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600' }; const splitLayoutGrid = { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '30px', alignItems: 'start' }; const largeCardBase = { background: 'white', padding: '30px', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.01)' }; const sectionHeading = { margin: '0 0 4px 0', fontSize: '1.25rem', color: '#1e293b', fontWeight: '800' }; const progressBarContainer = { width: '100%', height: '10px', background: '#f1f5f9', borderRadius: '20px', overflow: 'hidden' }; const progressBarFill = { height: '100%', borderRadius: '20px', transition: 'width 0.5s ease-out' }; const timelineRow = { display: 'flex', alignItems: 'center', background: '#f8fafc', padding: '12px 18px', borderRadius: '15px', border: '1px solid #e2e8f0' }; const timelineBullet = { width: '8px', height: '8px', background: '#000000', borderRadius: '50%', boxShadow: '0 0 0 4px rgba(0,0,0,0.05)' };

export default Statistics;