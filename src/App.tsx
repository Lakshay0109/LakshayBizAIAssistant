/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  Mail, 
  Search, 
  Bookmark, 
  Copy, 
  Upload, 
  CheckCircle2, 
  ChevronRight,
  TrendingUp,
  Briefcase,
  Users,
  Target,
  Zap,
  User as UserIcon,
  Sparkles,
  HelpCircle,
  MessageSquare,
  Video,
  Newspaper,
  LogOut,
  Settings,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { StatsDashboard } from './StatsDashboard';

// Initialize Gemini
// We only init the AI object if we have a key, we'll do this in the component or skip it since we use fetch directly for some calls.

interface Prompt {
  id: string;
  department: string;
  name: string;
  description: string;
  promptTemplate: string;
  outputMode: string;
  category: string;
  isCustom?: boolean;
}

const INITIAL_PROMPTS: Prompt[] = [
  { id: '1', department: 'HR', name: 'Job Description Writer', description: 'Turns a role title and responsibilities into a complete job description.', promptTemplate: 'Write a compelling job description for the following role.\nRole Title: [ROLE]\nKey Responsibilities:\n[RESPONSIBILITIES]\nInclude: Overview paragraph, day-to-day duties as bullet points, required qualifications, nice-to-have skills, and a short \'Why join us\' section. Keep it engaging and inclusive.', outputMode: 'email', category: 'HR' },
  { id: '2', department: 'HR', name: 'Performance Review Summariser', description: 'Converts rough manager notes into a structured performance summary.', promptTemplate: 'You are an HR professional. Convert these raw manager notes into a formal performance review summary.\n\nNotes:\n[NOTES]\nOutput format:\n- Overall performance: [Exceeds / Meets / Below expectations]\n- Key achievements (3 bullets)\n- Development areas (2 bullets)\n- Recommended actions\n- Suggested rating: [1-5]', outputMode: 'summary', category: 'HR' },
  { id: '3', department: 'Sales', name: 'Cold Email Generator', description: 'Writes a personalised cold outreach email for a specific prospect.', promptTemplate: 'Write a cold sales email.\nProspect company: [COMPANY]\nProspect role: [ROLE]\nTheir likely pain point: [PAIN_POINT]\nOur product/service: [OUR_OFFER]\nTone: friendly but professional. Subject line required. Under 120 words. End with one clear call to action.', outputMode: 'email', category: 'Sales' },
  { id: '4', department: 'Sales', name: 'Objection Handler', description: 'Turns a client objection into 3 empathetic, effective responses.', promptTemplate: 'A client has raised this objection:\n[OBJECTION]\n\nGenerate 3 different responses for our sales team to use. Each should:\n1. Acknowledge the concern genuinely\n2. Reframe it with a specific benefit\n3. Suggest a concrete next step\nLabel each response Option A, B, C.', outputMode: 'summary', category: 'Sales' },
  { id: '5', department: 'Finance', name: 'Variance Commentary', description: 'Generates professional finance commentary for budget vs actuals.', promptTemplate: 'Write a professional variance commentary for a finance report.\nBudget: [BUDGET]\nActual: [ACTUAL]\nVariance: [VARIANCE]\nContext: [CONTEXT]\nExplain the variance, likely root causes, and whether it is a concern or within acceptable range. Use formal finance language. 3 paragraphs maximum.', outputMode: 'summary', category: 'Finance' },
  { id: '6', department: 'Finance', name: 'Invoice Anomaly Detector', description: 'Checks invoice data for errors or unusual patterns.', promptTemplate: 'Analyse this invoice data and flag any anomalies, errors, or unusual patterns.\nReturn a JSON object: { flagged: true/false, issues: [list of issues], severity: \'Low/Medium/High\', recommendation: \'action to take\' }\n\nInvoice data:\n[INVOICE_DATA]', outputMode: 'json', category: 'Finance' },
  { id: '7', department: 'Operations', name: 'SOP Drafter', description: 'Converts a plain-language process description into a formal SOP.', promptTemplate: 'Write a Standard Operating Procedure (SOP) document.\nProcess name: [PROCESS_NAME]\nProcess description: [DESCRIPTION]\nFormat: Title, Purpose, Scope, Roles & Responsibilities, Step-by-step instructions (numbered), Notes & warnings, Version 1.0 footer.\nTone: clear, professional, unambiguous.', outputMode: 'summary', category: 'Operations' },
  { id: '8', department: 'Operations', name: 'Meeting Agenda Builder', description: 'Creates a structured meeting agenda from a topic list.', promptTemplate: 'Create a professional meeting agenda.\nMeeting purpose: [PURPOSE]\nAttendees: [ATTENDEES]\nDuration: [DURATION]\nTopics to cover: [TOPICS]\nFormat each agenda item with: time allocation, presenter, desired outcome. Add a 5-minute buffer and an AOB section at the end.', outputMode: 'summary', category: 'Operations' },
  { id: '9', department: 'HR', name: 'Policy Q&A System Prompt', description: 'A system prompt to make AI answer questions from your HR policy document.', promptTemplate: 'You are a helpful HR assistant with access to the company policy document provided. Answer employee questions accurately and cite the specific policy section where possible. If the answer is not in the document, say \'This is not covered in our current policy — please contact HR directly.\' Be empathetic and clear.\n\nPolicy document:\n[PASTE_POLICY_DOCUMENT_HERE]', outputMode: 'summary', category: 'HR' },
  { id: '10', department: 'Sales', name: 'Proposal Executive Summary', description: 'Generates a concise executive summary from a full proposal document.', promptTemplate: 'Read this proposal and write a 1-page executive summary for a busy C-level reader.\nHighlight: the problem being solved, our proposed solution, key benefits (3 max), investment required, and recommended next step.\nTone: confident, results-focused. No jargon.\n\nProposal content:\n[PROPOSAL_CONTENT]', outputMode: 'summary', category: 'Sales' }
];

const SYSTEM_PROMPT = `You are a professional corporate meeting assistant. You help teams extract value from meeting notes quickly and accurately.
Rules: Be concise. Use clear headings. Extract owner names from context. Flag any items marked as urgent. Never add information that wasn't in the notes.`;

const SAMPLE_NOTES_PLACEHOLDER = "Example: Sales team sync — 14 Jan 2026. Present: Ahmed, Priya, James. Q1 pipeline discussed. Ahmed to follow up with TechCorp by Friday. Priya presented deck — approved for client send. James flagged delay on proposal — needs legal review first...";

type Tab = 'summariser' | 'email' | 'qa' | 'library' | 'stats';

interface ActionItem {
  task: string;
  owner: string;
  deadline: string;
  isUrgent: boolean;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<Tab>('summariser');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKey, setTempKey] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Meeting Summariser State
  const [meetingNotes, setMeetingNotes] = useState('');
  const [summaryMode, setSummaryMode] = useState<'Summary Only' | 'Action Items Only' | 'Full Report'>('Summary Only');
  const [summaryOutput, setSummaryOutput] = useState('');
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  // Email Drafter State
  const [emailDescription, setEmailDescription] = useState('');
  const [emailContext, setEmailContext] = useState('');
  const [emailTone, setEmailTone] = useState<'Professional' | 'Friendly' | 'Assertive' | 'Concise'>('Professional');
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailOutput, setEmailOutput] = useState({ subject: '', body: '', tone: '', wordCount: 0 });

  const EMAIL_TONES = [
    { id: 'Professional', label: 'Professional', desc: 'Formal, structured, respectful distance', icon: Briefcase },
    { id: 'Friendly', label: 'Friendly', desc: 'Warm, approachable, uses first names', icon: Users },
    { id: 'Assertive', label: 'Assertive', desc: 'Direct and clear, no ambiguity', icon: Target },
    { id: 'Concise', label: 'Concise', desc: 'Under 100 words, to the point', icon: TrendingUp }
  ];

  // Q&A State
  const [qaFile, setQaFile] = useState<File | null>(null);
  const [qaFileBase64, setQaFileBase64] = useState<string>('');
  const [qaFileText, setQaFileText] = useState<string>('');
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaConversation, setQaConversation] = useState<{q: string, a: string}[]>([]);
  const [qaError, setQaError] = useState<string | null>(null);

  // Library State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  
  const [prompts, setPrompts] = useState<Prompt[]>(INITIAL_PROMPTS);
  
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [placeholders, setPlaceholders] = useState<Record<string, string>>({});
  
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<Partial<Prompt>>({ department: 'HR' });
  const [showGuide, setShowGuide] = useState(false);

  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthLoading(true);
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setApiKey(data.geminiApiKey || null);
            setShowGuide(!data.guideSeen); // if not true, show guide
          } else {
            setShowGuide(true);
          }

          // Fetch custom prompts
          const promptsRef = collection(db, "users", currentUser.uid, "prompts");
          const promptsSnap = await getDocs(promptsRef);
          const customPrompts: Prompt[] = [];
          promptsSnap.forEach(d => {
            customPrompts.push({ id: d.id, ...d.data() } as Prompt);
          });
          setPrompts([...customPrompts, ...INITIAL_PROMPTS]);

        } catch (err) {
          console.error("Failed to load user data:", err);
        }
      } else {
        setApiKey(null);
        setPrompts(INITIAL_PROMPTS);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setSignInError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Sign-in failed:", err);
      if (err.code === 'auth/unauthorized-domain') {
        setSignInError("Your domain is not authorized. Please add it to your Firebase Console under Authentication > Settings > Authorized domains.");
      } else if (err.code === 'auth/popup-blocked') {
        setSignInError("Sign-in popup blocked by the browser. Please allow popups or open this app in a new tab (using the button in the top right of this preview).");
      } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
        setSignInError("Sign-in popup was closed before completing. Please try again, or open the app in a new tab if it fails to open.");
      } else {
        setSignInError(err.message || "Failed to sign in");
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign-out failed:", err);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleCopyToast = (text: string, msg?: string) => {
    navigator.clipboard.writeText(text);
    // simpler toast 
    const el = document.createElement('div');
    el.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-bounce transition-all';
    el.innerText = msg || 'Copied!';
    document.body.appendChild(el);
    setTimeout(() => {
      document.body.removeChild(el);
    }, 3000);
  };

  const saveApiKey = async () => {
    if (tempKey.trim() && user) {
      try {
        await setDoc(doc(db, "users", user.uid), { geminiApiKey: tempKey.trim() }, { merge: true });
        setApiKey(tempKey.trim());
        setShowKeyModal(false);
        setTempKey('');
      } catch (err) {
        console.error("Failed to save API key", err);
      }
    }
  };

  const parseActionItems = (text: string): ActionItem[] => {
    // Simple parser for demonstration. In a real app, you might ask AI for structured JSON.
    // For this implementation, we'll look for specific patterns in the AI response if we want structured rows.
    // However, to ensure reliability for the specific "pill" requirement, we'll wrap the AI request to return structured data when needed.
    return []; 
  };

  const handleSummarise = async () => {
    if (!meetingNotes || !apiKey) return;
    setLoading(true);
    setError(null);
    setSummaryOutput('');
    setActionItems([]);

    const startTime = Date.now();
    let isSuccess = false;
    let errMsg: string | null = null;
    const modelUsed = 'gemini-3-flash-preview';
    let fullPromptLength = 0;
    let responseTextLength = 0;

    try {
      const fullPrompt = `${SYSTEM_PROMPT}\n\nMODE: ${summaryMode}\n\nMEETING NOTES:\n${meetingNotes}`;
      fullPromptLength = fullPrompt.length;
      
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: modelUsed,
        contents: fullPrompt,
      });
      
      const resultText = response.text;
      if (!resultText) {
        throw new Error('AI returned an empty or invalid response');
      }
      
      responseTextLength = resultText.length;
      isSuccess = true;
      
      setSummaryOutput(resultText);

      // Extract Action Items structured data if mode is Action Items or Full Report
      if (summaryMode !== 'Summary Only') {
        const structuralPrompt = `Extract action items from these notes as a JSON array of objects with keys: task, owner, deadline (use TBD if unknown), isUrgent (boolean). Only return the JSON.\n\nNOTES:\n${meetingNotes}`;
        
        try {
          const structResponse = await ai.models.generateContent({
            model: modelUsed,
            contents: structuralPrompt,
          });
          
          const jsonStr = structResponse.text?.replace(/```json|```/g, '').trim();
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr);
              setActionItems(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              console.error("Failed to parse action items JSON", e);
            }
          }
        } catch (stErr) {
          console.error("Failed to extract structural data", stErr);
        }
      }

      // Auto-scroll to output
      setTimeout(() => {
        outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      // Save summary history if user is logged in
      if (user) {
        try {
          await addDoc(collection(db, "users", user.uid, "summaries"), {
            mode: summaryMode,
            notesPrompt: meetingNotes.substring(0, 100) + '...',
            summaryOutput: resultText,
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.error("Failed to save summary history", e);
        }
      }

    } catch (err) {
      console.error(err);
      errMsg = err instanceof Error ? err.message : "Could not reach AI. Check your API key or internet connection.";
      setError(errMsg);
    } finally {
      setLoading(false);
      logAiEvent({
        feature: 'meeting_summariser',
        subMode: summaryMode,
        model: modelUsed,
        promptTokens: Math.ceil(fullPromptLength / 4),
        responseTokens: Math.ceil(responseTextLength / 4),
        latencyMs: Date.now() - startTime,
        success: isSuccess,
        errorMessage: errMsg,
        inputLength: meetingNotes.length
      });
    }
  };

  const renderMarkdown = (text: string) => {
    // Basic markdown helper
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold mt-4 mb-2">{line.replace('### ', '')}</h3>;
      if (line.startsWith('- ')) return <li key={i} className="ml-4 list-disc mb-1">{line.replace('- ', '')}</li>;
      
      // Bold handling
      const boldParts = line.split(/(\*\*.*?\*\*)/g);
      return (
        <p key={i} className="mb-2">
          {boldParts.map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={j}>{part.slice(2, -2)}</strong>;
            }
            return part;
          })}
        </p>
      );
    });
  };

  const handleEmailSummary = () => {
    const subject = `Meeting Summary — ${new Date().toLocaleDateString()}`;
    const body = encodeURIComponent(summaryOutput);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const resetSummary = () => {
    setMeetingNotes('');
    setSummaryOutput('');
    setActionItems([]);
    setError(null);
  };

  // ... rest of email/qa logic ...

  const handleDraftEmail = async (modifier?: string) => {
    if (!emailDescription || !apiKey) return;
    setLoading(true);
    setError(null);
    const startTime = Date.now();
    let isSuccess = false;
    let errMsg: string | null = null;
    const modelUsed = 'gemini-3-flash-preview';
    let fullPromptLength = 0;
    let responseTextLength = 0;
    const selectedTone = EMAIL_TONES.find(t => t.id === emailTone);
    try {
      const systemPrompt = `You are an expert corporate communication specialist. You write clear, effective emails tailored to the specified tone.
Rules: Always include a subject line labelled 'Subject:'.
Write the full email body below. Match the tone exactly.
No placeholders — if context is missing, use professional defaults.
Never exceed 250 words unless the Detailed tone is selected.
Sign off appropriately for the chosen tone.`;
      
      const fullPrompt = `${systemPrompt}\n\nTONE: ${selectedTone?.label} — ${selectedTone?.desc}\nRECIPIENT: ${emailRecipient || 'colleague'}\nCONTEXT: ${emailContext || 'None provided'}\nTASK: ${emailDescription}\nWrite a complete professional email.${modifier ? `\n\n${modifier}` : ''}`;
      fullPromptLength = fullPrompt.length;
      
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: modelUsed,
        contents: fullPrompt,
        config: {
          temperature: 0.6,
        }
      });

      let resultText = response.text;
      if (!resultText) {
        throw new Error('AI returned an empty or invalid response');
      }
      
      responseTextLength = resultText.length;
      isSuccess = true;
      
      let subject = 'Email Draft';
      const subjectMatch = resultText.match(/Subject:\s*(.*)/i);
      if (subjectMatch) {
         subject = subjectMatch[1].trim();
         resultText = resultText.replace(/.*?Subject:\s*.*\n?/i, '').trim();
      }

      const wordCount = resultText.split(/\s+/).filter(w => w.length > 0).length;

      setEmailOutput({
        subject,
        body: resultText,
        tone: selectedTone?.label || 'Professional',
        wordCount
      });
    } catch (err) {
      console.error(err);
      errMsg = err instanceof Error ? err.message : 'Could not generate email draft.';
      setError(errMsg);
    } finally {
      setLoading(false);
      logAiEvent({
        feature: 'email_drafter',
        subMode: selectedTone?.label || 'Professional',
        model: modelUsed,
        promptTokens: Math.ceil(fullPromptLength / 4),
        responseTokens: Math.ceil(responseTextLength / 4),
        latencyMs: Date.now() - startTime,
        success: isSuccess,
        errorMessage: errMsg,
        inputLength: emailDescription.length
      });
    }
  };

  const handleFileUpload = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    const validExts = ['pdf', 'png', 'jpg', 'jpeg', 'txt', 'csv', 'docx'];
    
    if (!validTypes.includes(file.type) && (!ext || !validExts.includes(ext))) {
      setQaError("Unsupported file type. Try PDF, PNG, JPG, or TXT.");
      return;
    }
    
    setQaError(null);
    setQaFile(file);
    setQaConversation([]);
    setQaFileBase64('');
    setQaFileText('');
    setQaQuestion('');

    const isText = file.type === 'text/plain' || file.type === 'text/csv' || ext === 'txt' || ext === 'csv';

    if (isText) {
      const reader = new FileReader();
      reader.onload = (e) => setQaFileText(e.target?.result as string);
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Parts = (e.target?.result as string).split(',');
        if (base64Parts.length === 2) {
          setQaFileBase64(base64Parts[1]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const clearQa = () => {
    setQaFile(null);
    setQaFileBase64('');
    setQaFileText('');
    setQaQuestion('');
    setQaConversation([]);
    setQaError(null);
  };

  const handleAskQA = async (questionOverride?: string) => {
    const currentQ = questionOverride || qaQuestion;
    if (!currentQ || !qaFile || !apiKey) return;
    setLoading(true);
    setQaError(null);

    const startTime = Date.now();
    let isSuccess = false;
    let errMsg: string | null = null;
    const modelUsed = 'gemini-3-flash-preview';
    let fullPromptLength = 0;
    let responseTextLength = 0;

    try {
      const systemPromptText = "You are a precise document analyst. Answer only from the document provided. If the answer is not in the document, say so clearly. Be concise.\nEnd every answer with: Source: [quote the exact sentence or figure from the document that supports your answer].";
      
      let requestContents: any[] = [];
      const isFirstTurn = qaConversation.length === 0;
      
      let filePart = null;
      if (isFirstTurn) {
        if (qaFileText) {
          filePart = { text: `--- DOCUMENT CONTENT ---\n${qaFileText}\n--- END DOCUMENT ---` };
        } else if (qaFileBase64) {
          filePart = { inlineData: { mimeType: qaFile.type || (qaFile.name.endsWith('.docx') ? 'application/pdf' : 'application/pdf'), data: qaFileBase64 } };
        }
      }

      for (let i = 0; i < qaConversation.length; i++) {
        requestContents.push({ role: 'user', parts: [{ text: qaConversation[i].q }] });
        requestContents.push({ role: 'model', parts: [{ text: qaConversation[i].a }] });
      }

      let newTurnParts = [];
      if (isFirstTurn) {
        newTurnParts.push({ text: `SYSTEM: ${systemPromptText}` });
        if (filePart) newTurnParts.push(filePart);
      }
      newTurnParts.push({ text: `QUESTION: ${currentQ}` });
      
      requestContents.push({ role: 'user', parts: newTurnParts });

      fullPromptLength = JSON.stringify(requestContents).length;

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: modelUsed,
        contents: requestContents,
      });

      const answer = response.text || 'No answer found.';
      
      responseTextLength = answer.length;
      isSuccess = true;

      setQaConversation([...qaConversation, { q: currentQ, a: answer }]);
      setQaQuestion('');
    } catch (e: any) {
       console.error(e);
       errMsg = e.message || "Failed to analyze document";
       setQaError(errMsg);
    } finally {
      setLoading(false);
      logAiEvent({
        feature: 'document_qa',
        subMode: 'Chat',
        model: modelUsed,
        promptTokens: Math.ceil(fullPromptLength / 4),
        responseTokens: Math.ceil(responseTextLength / 4),
        latencyMs: Date.now() - startTime,
        success: isSuccess,
        errorMessage: errMsg,
        inputLength: currentQ.length
      });
    }
  };

  const filteredPrompts = prompts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'All' || p.department === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const getDepartmentColor = (dept: string) => {
    switch (dept) {
      case 'HR': return 'bg-green-100 text-green-800 border-green-200';
      case 'Sales': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Finance': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Operations': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleOpenPromptModal = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    // Find all placeholders like [ROLE], [COMPANY]
    const matches = prompt.promptTemplate.match(/\[(.*?)\]/g) || [];
    const newPlaceholders: Record<string, string> = {};
    matches.forEach(m => {
      newPlaceholders[m] = '';
    });
    setPlaceholders(newPlaceholders);
  };

  const generateFilledPrompt = () => {
    if (!selectedPrompt) return '';
    let text = selectedPrompt.promptTemplate;
    Object.entries(placeholders).forEach(([key, val]) => {
      const stringVal = val as string;
      if (stringVal.trim() !== '') {
        text = text.replace(new RegExp(`\\${key}`, 'g'), stringVal);
      }
    });
    return text;
  };

  const handleSaveCustomPrompt = async () => {
    if (!customPrompt.name || !customPrompt.promptTemplate || !user) return;
    const newPrompt: Prompt = {
      id: Date.now().toString(),
      name: customPrompt.name!,
      description: customPrompt.description || '',
      department: customPrompt.department || 'Other',
      promptTemplate: customPrompt.promptTemplate!,
      outputMode: 'summary',
      category: customPrompt.department || 'Other',
      isCustom: true
    };

    try {
      await setDoc(doc(db, "users", user.uid, "prompts", newPrompt.id), newPrompt);
      const updated = [newPrompt, ...prompts];
      setPrompts(updated);
      
      setShowCustomModal(false);
      setCustomPrompt({ department: 'HR' });
    } catch (err) {
      console.error("Failed to save custom prompt", err);
    }
  };

  const handleExportLibrary = () => {
    const dataStr = JSON.stringify(prompts, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `bizassist-prompts-${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImportLibrary = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
           // Basic validation
           const validImports = imported.filter(p => p.id && p.name && p.promptTemplate);
           const importedCustoms = validImports.map(p => ({...p, isCustom: true}));
           const merged = [...importedCustoms, ...prompts];
           // Deduplicate by ID just in case
           const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
           setPrompts(unique);
           
           if (user) {
             for (const p of importedCustoms) {
               await setDoc(doc(db, "users", user.uid, "prompts", p.id), p);
             }
           }
        }
      } catch (err) {
        console.error("Failed to parse JSON", err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const markGuideSeen = async () => {
    setShowGuide(false);
    if (user) {
      try {
        await setDoc(doc(db, "users", user.uid), { guideSeen: true }, { merge: true });
      } catch (err) {
        console.error("Failed to save guide seen", err);
      }
    }
  };

  const logAiEvent = async (eventData: {
    feature: string,
    subMode: string,
    model: string,
    promptTokens: number,
    responseTokens: number,
    latencyMs: number,
    success: boolean,
    errorMessage: string | null,
    inputLength: number
  }) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "ai_events"), {
        timestamp: serverTimestamp(),
        userId: user.uid,
        userEmail: user.email,
        feature: eventData.feature,
        subMode: eventData.subMode,
        model: eventData.model,
        promptTokens: eventData.promptTokens,
        responseTokens: eventData.responseTokens,
        latencyMs: eventData.latencyMs,
        success: eventData.success,
        errorMessage: eventData.errorMessage,
        inputLength: eventData.inputLength
      });
    } catch (err) {
      console.error("Failed to log AI event", err);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center font-sans bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-gray-500 font-medium">Loading BizAssist AI...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center font-sans bg-gray-50 p-4">
        <div className="bg-white max-w-md w-full p-8 rounded-3xl shadow-xl border border-gray-100 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-white shadow-lg mb-6">
            <Zap size={32} fill="currentColor" />
          </div>
          <h1 className="text-2xl font-bold text-dark-accent mb-2">Welcome to BizAssist AI</h1>
          <p className="text-gray-500 mb-8">Sign in to access your AI corporate assistant and prompt library.</p>
          
          {signInError && (
            <div className="w-full bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 border border-red-100 text-left">
              <strong>Sign In Error:</strong> {signInError}
            </div>
          )}

          <button 
            onClick={handleSignIn}
            className="w-full bg-primary text-white py-4 rounded-xl font-bold hover:bg-opacity-90 transition-all shadow-md flex items-center justify-center gap-2"
          >
            <UserIcon size={20} />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* 1. TOP NAVBAR */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 sm:px-8 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white shadow-md">
            <Zap size={18} fill="currentColor" />
          </div>
          <span className="text-xl font-bold tracking-tight text-dark-accent">BizAssist <span className="text-primary italic">AI</span></span>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Powered by</span>
          <div className="flex gap-0.5">
            <span className="text-blue-500 font-bold">G</span>
            <span className="text-red-500 font-bold">e</span>
            <span className="text-yellow-500 font-bold">m</span>
            <span className="text-blue-500 font-bold">i</span>
            <span className="text-green-500 font-bold">n</span>
            <span className="text-red-500 font-bold">i</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowGuide(true)}
            className="text-gray-500 hover:text-primary transition-colors p-2 bg-gray-50 rounded-full border border-gray-200"
            title="User Guide"
          >
            <HelpCircle size={18} />
          </button>
          
          <button 
            onClick={() => setShowKeyModal(true)}
            className="text-gray-500 hover:text-primary transition-colors p-2 bg-gray-50 rounded-full border border-gray-200"
            title="Settings"
          >
            <Settings size={18} />
          </button>

          <button 
            onClick={handleSignOut}
            className="text-gray-500 hover:text-red-500 transition-colors p-2 bg-gray-50 rounded-full border border-gray-200"
            title="Sign Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* 2. TAB NAVIGATION */}
      <div className="max-w-4xl mx-auto w-full px-4 pt-6">
        <div className="flex gap-1 overflow-x-auto p-1 bg-gray-100 rounded-xl no-scrollbar mb-8">
          {[
            { id: 'summariser', label: 'Meeting Summariser', icon: <FileText size={16} />, emoji: '📝' },
            { id: 'email', label: 'Email Drafter', icon: <Mail size={16} />, emoji: '✉️' },
            { id: 'qa', label: 'Document Q&A', icon: <Search size={16} />, emoji: '🔍' },
            { id: 'library', label: 'Prompt Library', icon: <Bookmark size={16} />, emoji: '🔖' },
            { id: 'stats', label: 'Stats', icon: <Activity size={16} />, emoji: '📊' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap whitespace-nowrap ${
                activeTab === tab.id 
                ? 'bg-white text-primary shadow-sm ring-1 ring-black/5' 
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="opacity-80">{tab.emoji}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <main className="pb-12">
          {!apiKey && activeTab !== 'library' && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-4 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center text-white">
                  <Zap size={18} fill="currentColor" />
                </div>
                <p className="text-sm font-medium text-yellow-800">Add your Gemini API key in Settings to enable AI</p>
              </div>
              <button 
                onClick={() => setShowKeyModal(true)}
                className="text-sm font-bold text-yellow-800 underline hover:no-underline"
              >
                Add Key
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* 3. MEETING SUMMARISER TAB */}
            {activeTab === 'summariser' && (
              <motion.div
                key="summariser"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {error && (
                  <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center justify-between">
                    <p className="text-sm text-red-800 font-medium">{error}</p>
                    <button 
                      onClick={handleSummarise}
                      className="text-xs font-bold bg-white text-red-800 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50"
                    >
                      Retry
                    </button>
                  </div>
                )}

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <div className="p-1.5 bg-green-50 text-primary rounded-md">
                      <FileText size={18} />
                    </div>
                    Meeting Summariser
                  </h2>
                  
                  <textarea
                    placeholder={SAMPLE_NOTES_PLACEHOLDER}
                    className="w-full h-48 p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm resize-none placeholder:text-gray-300"
                    value={meetingNotes}
                    onChange={(e) => setMeetingNotes(e.target.value)}
                  />

                  <div className="mt-6 space-y-4">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Output Type</label>
                    <div className="flex flex-wrap gap-2">
                      {['Summary Only', 'Action Items Only', 'Full Report'].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setSummaryMode(mode as any)}
                          className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                            summaryMode === mode 
                            ? 'bg-primary text-white border-primary shadow-md' 
                            : 'bg-white text-gray-600 border-gray-200 hover:border-primary/50'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleSummarise}
                    disabled={!meetingNotes || !apiKey || loading}
                    className="w-full mt-8 bg-primary text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/20"
                  >
                    {loading ? (
                      <div className="flex items-center gap-2">
                         <div className="flex gap-1">
                            <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="w-1.5 h-1.5 bg-white rounded-full" />
                            <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-white rounded-full" />
                            <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-white rounded-full" />
                         </div>
                         Analysing notes...
                      </div>
                    ) : (
                      <>
                        <Zap size={18} />
                        Summarise with AI
                      </>
                    )}
                  </button>
                </div>

                <div ref={outputRef}>
                  {summaryOutput && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 relative group mb-4"
                    >
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6 flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-primary" />
                        AI Analysis Complete
                      </h3>
                      
                      <div className="text-gray-700 mb-8 leading-relaxed">
                        {renderMarkdown(summaryOutput)}
                      </div>

                      {actionItems.length > 0 && (
                        <div className="mt-8 pt-8 border-t border-gray-100">
                           <h4 className="text-sm font-bold text-dark-accent mb-4">Action Items</h4>
                           <div className="space-y-3">
                              {actionItems.map((item, idx) => (
                                <div key={idx} className="flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                                  <input type="checkbox" className="mt-1 w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center flex-wrap gap-2 mb-1">
                                      <p className="text-sm font-medium text-gray-700">{item.task}</p>
                                      {item.isUrgent && (
                                        <span className="px-1.5 py-0.5 bg-red-50 text-red-600 text-[10px] font-bold rounded animate-pulse uppercase">Urgent</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-primary border border-green-100">
                                        <Users size={10} className="mr-1" />
                                        {item.owner}
                                      </span>
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                                        <FileText size={10} className="mr-1" />
                                        {item.deadline}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                           </div>
                        </div>
                      )}

                      <div className="mt-8 pt-6 border-t border-gray-100 flex flex-wrap gap-3">
                        <button
                          onClick={() => handleCopy(summaryOutput)}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-100 transition-all border border-gray-100"
                        >
                          {copied ? <><CheckCircle2 size={16} className="text-primary" /> Copied!</> : <><Copy size={16} /> Copy Summary</>}
                        </button>
                        <button
                          onClick={handleEmailSummary}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-100 transition-all border border-gray-100"
                        >
                          <Mail size={16} /> Email This Summary
                        </button>
                        <button
                          onClick={resetSummary}
                          className="flex items-center gap-2 px-4 py-2 bg-white text-gray-400 rounded-lg text-sm font-bold hover:text-red-500 transition-all border border-gray-100 ml-auto"
                        >
                          <Lightning size={16} className="rotate-12" /> Start New Summary
                        </button>
                      </div>
                    </motion.div>
                  )}
                  
                  {!summaryOutput && !loading && (
                    <div className="bg-white/50 p-12 rounded-2xl border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400">
                      <FileText size={32} className="mb-2 opacity-20" />
                      <p className="text-sm">Your AI summary will appear here</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* 4. EMAIL DRAFTER TAB */}
            {activeTab === 'email' && (
              <motion.div
                key="email"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {error && (
                  <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center justify-between">
                    <p className="text-sm text-red-800 font-medium">{error}</p>
                    <button 
                      onClick={() => handleDraftEmail()}
                      className="text-xs font-bold bg-white text-red-800 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50"
                    >
                      Retry
                    </button>
                  </div>
                )}

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <div className="p-1.5 bg-green-50 text-primary rounded-md">
                      <Mail size={18} />
                    </div>
                    Email Drafter
                  </h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">The Goal</label>
                      <textarea
                        placeholder="What do you want to say? Describe in plain language..."
                        className="w-full min-h-[120px] p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm resize-y"
                        value={emailDescription}
                        onChange={(e) => setEmailDescription(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Context (Optional)</label>
                      <textarea
                        placeholder="Any context AI should know? E.g. previous interactions, company name, urgency level"
                        className="w-full h-16 p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm resize-none"
                        value={emailContext}
                        onChange={(e) => setEmailContext(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Recipient</label>
                      <input
                        type="text"
                        placeholder="Who is this to? Role or name (optional)"
                        className="w-full p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
                        value={emailRecipient}
                        onChange={(e) => setEmailRecipient(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 block">Tone Selection</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        {EMAIL_TONES.map((tone) => {
                          const Icon = tone.icon;
                          return (
                            <button
                              key={tone.id}
                              onClick={() => setEmailTone(tone.id as any)}
                              className={`p-4 rounded-xl border text-left transition-all flex flex-col gap-2 ${
                                emailTone === tone.id 
                                ? 'border-primary bg-green-50 ring-1 ring-primary' 
                                : 'border-gray-200 bg-white text-gray-600 hover:border-primary/50'
                              }`}
                            >
                              <div className={`flex items-center gap-2 ${emailTone === tone.id ? 'text-primary' : 'text-gray-700'}`}>
                                <Icon size={16} />
                                <span className="text-sm font-bold">{tone.label}</span>
                              </div>
                              <span className="text-xs opacity-80 leading-relaxed text-gray-500">{tone.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDraftEmail()}
                    disabled={!emailDescription || !apiKey || loading}
                    className="w-full mt-8 bg-primary text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/20"
                  >
                    {loading ? (
                      <div className="flex items-center gap-2">
                         <div className="flex gap-1">
                            <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="w-1.5 h-1.5 bg-white rounded-full" />
                            <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-white rounded-full" />
                            <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-white rounded-full" />
                         </div>
                         Drafting...
                      </div>
                    ) : (
                      <>
                        <Zap size={18} />
                        Draft Email with AI
                      </>
                    )}
                  </button>
                </div>

                {emailOutput.body && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100"
                  >
                    <div className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50/50 rounded-t-2xl gap-4">
                       <div className="flex-1 pr-4">
                         <span className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5 tracking-widest">Subject</span>
                         <h4 className="text-sm font-bold text-gray-800">{emailOutput.subject}</h4>
                       </div>
                       <div className="flex items-center gap-3">
                         <span className="px-3 py-1 bg-white border border-gray-200 rounded-full text-xs font-bold text-gray-600 shadow-sm">
                           {emailOutput.tone}
                         </span>
                         <button
                           onClick={() => handleCopy(emailOutput.subject)}
                           className="p-2 text-gray-400 hover:text-primary hover:bg-white rounded-lg transition-all border border-gray-200"
                           title="Copy Subject"
                         >
                           {copied ? <CheckCircle2 size={16} className="text-primary" /> : <Copy size={16} />}
                         </button>
                       </div>
                    </div>
                    <div className="p-6">
                      <span className="text-[10px] font-bold text-gray-400 uppercase block mb-3 tracking-widest">Body</span>
                      <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                        {emailOutput.body}
                      </div>
                      <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center text-xs font-medium text-gray-400">
                        <span>{emailOutput.wordCount} words</span>
                      </div>
                    </div>
                    <div className="p-4 bg-gray-50/50 flex flex-wrap gap-2 rounded-b-2xl">
                      <button
                        onClick={() => handleDraftEmail()}
                        className="flex-1 min-w-[120px] py-2 px-3 bg-white border border-gray-200 text-gray-600 font-bold text-xs rounded-lg hover:bg-gray-50 transition-all flex justify-center items-center gap-1"
                      >
                        <Zap size={14} className="text-gray-400" /> Regenerate
                      </button>
                      <button
                        onClick={() => handleDraftEmail("Revise this to be at least 30% shorter while keeping all key information.")}
                        className="flex-1 min-w-[120px] py-2 px-3 bg-white border border-gray-200 text-gray-600 font-bold text-xs rounded-lg hover:bg-gray-50 transition-all flex justify-center items-center gap-1"
                      >
                        <TrendingUp size={14} className="text-gray-400" /> Make It Shorter
                      </button>
                      <button
                        onClick={() => handleDraftEmail("Rewrite at a higher formality level.")}
                        className="flex-1 min-w-[120px] py-2 px-3 bg-white border border-gray-200 text-gray-600 font-bold text-xs rounded-lg hover:bg-gray-50 transition-all flex justify-center items-center gap-1"
                      >
                        <Briefcase size={14} className="text-gray-400" /> Make It More Formal
                      </button>
                      <button
                        onClick={() => handleCopy(`Subject: ${emailOutput.subject}\n\n${emailOutput.body}`)}
                        className="w-full sm:w-auto py-2 px-6 bg-primary text-white font-bold text-xs rounded-lg hover:bg-opacity-90 transition-all flex justify-center items-center gap-1 shadow-sm"
                      >
                        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />} Copy Full Email
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* 5. DOCUMENT Q&A TAB */}
            {activeTab === 'qa' && (
              <motion.div
                key="qa"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {qaError && (
                  <div className="bg-red-50 border border-red-100 p-4 rounded-xl flex items-center gap-3">
                    <p className="text-sm text-red-800 font-medium">{qaError}</p>
                  </div>
                )}
                
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <div className="p-1.5 bg-green-50 text-primary rounded-md">
                         <Search size={18} />
                       </div>
                       Document & Image Q&A
                    </div>
                  </h2>

                  <div className="space-y-6">
                    <div 
                      className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer ${
                        qaFile ? 'border-primary bg-green-50/30' : 'border-gray-200 hover:border-primary/50 bg-gray-50/50'
                      }`}
                      onClick={() => !qaFile && document.getElementById('file-upload')?.click()}
                    >
                      <input 
                        id="file-upload" 
                        type="file" 
                        className="hidden" 
                        onChange={handleFileUpload}
                        accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx"
                      />
                      {qaFile ? (
                        <div className="w-full text-center">
                          <div className="w-12 h-12 bg-primary mx-auto rounded-full flex items-center justify-center text-white mb-3 shadow-lg shadow-green-500/30">
                            <CheckCircle2 size={24} />
                          </div>
                          <p className="font-bold text-primary flex items-center justify-center gap-2">
                             {qaFile.name} 
                             <span className="text-[10px] uppercase bg-green-100 text-green-800 px-2 py-0.5 rounded-full">{qaFile.name.split('.').pop()}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-2">{(qaFile.size / 1024 / 1024).toFixed(2)} MB</p>
                          {(qaFile.type === 'application/pdf' || qaFile.name.endsWith('.docx')) && (
                             <p className="text-xs text-gray-400 mt-2 max-w-sm mx-auto">AI will analyse the document content. For best results, ensure text is searchable (not scanned images).</p>
                          )}
                          <button 
                             onClick={(e) => { e.stopPropagation(); clearQa(); }}
                             className="mt-4 text-xs font-bold bg-white text-gray-500 px-4 py-2 border border-gray-200 rounded-lg hover:text-red-500 hover:border-red-200 transition-colors"
                          >
                             Change File
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="w-12 h-12 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-400 mb-3 group-hover:text-primary transition-colors">
                            <Upload size={24} />
                          </div>
                          <p className="text-sm font-medium text-gray-600">Drop a PDF, image, Word doc, or text file here</p>
                          <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                          <p className="text-[10px] text-gray-400 mt-4">Large PDFs may take a few seconds to analyse</p>
                        </>
                      )}
                    </div>

                    {!qaFile && (
                       <div className="text-left bg-gray-50 p-6 rounded-xl border border-gray-100 mt-8 shadow-inner">
                         <h4 className="text-sm font-bold text-gray-800 mb-4">Example Use Cases:</h4>
                         <ul className="space-y-4 text-sm text-gray-600">
                           <li className="flex gap-3 items-start"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0"/> <span>Upload a contract PDF and ask: <strong>"What are the payment terms?"</strong></span></li>
                           <li className="flex gap-3 items-start"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0"/> <span>Upload a chart image and ask: <strong>"What is the trend over time?"</strong></span></li>
                           <li className="flex gap-3 items-start"><CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0"/> <span>Upload meeting slides and ask: <strong>"What decisions were made?"</strong></span></li>
                         </ul>
                       </div>
                    )}

                    {qaFile && (
                      <div className="pt-4 border-t border-gray-100">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">
                           {qaConversation.length > 0 ? "Ask a follow-up" : "What would you like to know about this document?"}
                        </label>
                        <textarea
                          placeholder={qaConversation.length > 0 ? "Based on the same document..." : "Type your question here..."}
                          className="w-full h-24 p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm resize-none"
                          value={qaQuestion}
                          onChange={(e) => setQaQuestion(e.target.value)}
                        />
                        
                        <div className="flex gap-2 p-2 overflow-x-auto no-scrollbar mask-edges mt-1">
                          {(qaFile.type.startsWith('image/') || ['png','jpg','jpeg'].includes(qaFile.name.split('.').pop()?.toLowerCase()||'')) ? (
                            [
                              "Describe this image",
                              "Extract all text visible in this image",
                              "Summarise the data or chart shown",
                              "List all people, objects, or brands visible"
                            ].map((q, i) => (
                               <button 
                                 key={i} 
                                 onClick={() => setQaQuestion(q)}
                                 className="flex-shrink-0 text-[10px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-white hover:text-primary transition-colors whitespace-nowrap"
                               >
                                 {q}
                               </button>
                            ))
                          ) : (
                            [
                              "Summarise this document in 5 bullet points",
                              "What are the key numbers, dates, or deadlines mentioned?",
                              "List all action items or next steps",
                              "What is the main recommendation?",
                              "Extract all names and organisations mentioned"
                            ].map((q, i) => (
                               <button 
                                 key={i} 
                                 onClick={() => setQaQuestion(q)}
                                 className="flex-shrink-0 text-[10px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-white hover:text-primary transition-colors whitespace-nowrap"
                               >
                                 {q}
                               </button>
                            ))
                          )}
                        </div>

                        <div className="flex gap-3 mt-4">
                          <button
                            onClick={() => handleAskQA()}
                            disabled={!qaQuestion || !qaFile || loading}
                            className="flex-1 bg-primary text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-green-500/20 text-sm"
                          >
                            {loading ? (
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <>
                                <Search size={16} />
                                Ask AI
                              </>
                            )}
                          </button>
                          {qaConversation.length > 0 && (
                            <button
                               onClick={clearQa}
                               className="px-6 py-3 bg-white text-gray-600 font-bold text-sm border border-gray-200 flex items-center justify-center rounded-xl hover:bg-gray-50 transition-colors"
                            >
                               Clear & Start Over
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {qaConversation.length > 0 && (
                   <div className="space-y-4 pb-8">
                      {qaConversation.map((turn, i) => {
                         const parts = turn.a.split(/Source:/i);
                         const mainContent = parts[0];
                         const sourceContent = parts.length > 1 ? parts.slice(1).join('Source:') : null;

                         return (
                            <motion.div 
                              key={i}
                              initial={{ opacity: 0, scale: 0.98 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
                            >
                              <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-start gap-4">
                                <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-gray-500">
                                   <UserIcon size={12} />
                                </div>
                                <h4 className="text-sm font-medium text-gray-600 leading-relaxed">{turn.q}</h4>
                              </div>
                              <div className="p-6">
                                <span className="text-[10px] font-bold text-primary uppercase block mb-3 tracking-widest flex items-center gap-2"><Sparkles size={12}/> AI Answer</span>
                                <div className="prose prose-sm max-w-none text-gray-800">
                                  {renderMarkdown(mainContent.trim())}
                                </div>
                                {sourceContent && (
                                  <div className="mt-5 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs italic text-gray-600 shadow-inner">
                                    <span className="font-bold text-gray-800 not-italic mr-1 block mb-1">Source Quote:</span>
                                    "{sourceContent.trim()}"
                                  </div>
                                )}
                                <div className="mt-4 flex justify-end">
                                   <button 
                                      onClick={() => handleCopy(turn.a)}
                                      className="text-xs font-bold text-gray-400 hover:text-primary flex items-center gap-1"
                                   >
                                      {copied ? <CheckCircle2 size={12}/> : <Copy size={12}/>} Copy Answer
                                   </button>
                                </div>
                              </div>
                            </motion.div>
                         );
                      })}
                   </div>
                )}
              </motion.div>
            )}

            {/* 6. PROMPT LIBRARY TAB */}
            {activeTab === 'library' && (
              <motion.div
                key="library"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                   <div className="flex items-center gap-2">
                       <div className="p-1.5 bg-green-50 text-primary rounded-md">
                         <Bookmark size={18} />
                       </div>
                       <h2 className="text-lg font-bold">Team Prompt Library</h2>
                   </div>
                   <div className="flex gap-2">
                      <button 
                         onClick={handleExportLibrary}
                         className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                         Export Library
                      </button>
                      <button 
                         onClick={() => document.getElementById('import-library')?.click()}
                         className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                         Import
                      </button>
                      <input id="import-library" type="file" accept=".json" className="hidden" onChange={handleImportLibrary} />
                   </div>
                </div>

                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      placeholder="Search prompts by name or description..."
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all shadow-sm bg-white"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {['All', 'HR', 'Sales', 'Finance', 'Operations'].map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider transition-all border ${
                          activeFilter === filter 
                          ? 'bg-primary text-white border-primary shadow-sm' 
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredPrompts.map((prompt) => (
                    <motion.div
                      layout
                      key={prompt.id}
                      className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full group"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-widest border ${getDepartmentColor(prompt.department)}`}>
                          {prompt.department}
                        </span>
                        {prompt.isCustom && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 border border-yellow-200 text-[10px] font-bold rounded uppercase tracking-widest flex items-center gap-1">
                             <Sparkles size={10}/> Custom
                          </span>
                        )}
                      </div>
                      <h3 className="text-md font-bold text-gray-800 mb-2 group-hover:text-primary transition-colors">{prompt.name}</h3>
                      <p className="text-sm text-gray-500 line-clamp-3 mb-6 flex-grow">{prompt.description}</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleOpenPromptModal(prompt)}
                          className="flex-1 px-3 py-2 bg-primary text-white text-xs font-bold rounded-lg border border-primary hover:bg-opacity-90 transition-all flex items-center justify-center gap-1"
                        >
                          Use This Prompt <ChevronRight size={14} />
                        </button>
                        <button 
                          onClick={() => handleCopyToast(prompt.promptTemplate)}
                          className="px-3 py-2 bg-white text-gray-500 text-xs font-bold rounded-lg border border-gray-200 hover:border-gray-300 hover:text-gray-700 transition-all flex items-center justify-center gap-1"
                        >
                          <Copy size={14} /> Copy
                        </button>
                      </div>
                    </motion.div>
                  ))}
                  
                  {filteredPrompts.length === 0 && (
                    <div className="col-span-full py-12 text-center text-gray-400">
                      <Search size={40} className="mx-auto mb-3 opacity-10" />
                      <p>No prompts found matching your search.</p>
                    </div>
                  )}
                </div>
                
                <div className="mt-12 pt-8 border-t border-gray-200 flex flex-col items-center">
                   <div className="w-16 h-16 bg-gray-50 border border-gray-200 text-gray-400 rounded-full flex items-center justify-center mb-4">
                      <Bookmark size={24} />
                   </div>
                   <h3 className="text-lg font-bold text-gray-800 mb-2">Have a prompt that works well for you?</h3>
                   <p className="text-sm text-gray-500 mb-6 text-center max-w-md">Save your most frequent instructions as custom prompts so you can reuse them anytime.</p>
                   <button
                      onClick={() => setShowCustomModal(true)}
                      className="px-6 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 hover:text-primary transition-colors shadow-sm"
                   >
                      + Add Custom Prompt
                   </button>
                </div>
              </motion.div>
            )}

            {/* 7. STATS TAB */}
            {activeTab === 'stats' && (
              <StatsDashboard user={user} />
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* 7. FOOTER */}
      <footer className="mt-auto border-t border-gray-200 py-8 bg-white/50 px-4 text-center">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">
          BizAssist AI — Built in Session 1 • {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </footer>

      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      {/* API KEY MODAL */}
      <AnimatePresence>
        {showKeyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowKeyModal(false)}
              className="absolute inset-0 bg-dark-accent/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-8">
                <div className="w-16 h-16 bg-green-50 text-primary rounded-2xl flex items-center justify-center mb-6 shadow-sm">
                  <Zap size={32} fill="currentColor" />
                </div>
                <h3 className="text-2xl font-bold text-dark-accent mb-2">Connect to Gemini</h3>
                <p className="text-gray-500 mb-8 leading-relaxed">Enter your Google AI Studio API key to enable powerful AI features in BizAssist.</p>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">API Key</label>
                    <input
                      type="password"
                      placeholder="Paste your key here..."
                      className="w-full p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      value={tempKey}
                      onChange={(e) => setTempKey(e.target.value)}
                    />
                  </div>
                  <button 
                    onClick={saveApiKey}
                    className="w-full bg-primary text-white py-4 rounded-xl font-bold hover:bg-opacity-90 transition-all shadow-lg shadow-green-500/20"
                  >
                    Save & Enable AI
                  </button>
                  <button 
                    onClick={() => setShowKeyModal(false)}
                    className="w-full text-gray-400 py-2 text-sm font-medium hover:text-gray-600 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* USE PROMPT MODAL */}
        {selectedPrompt && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPrompt(null)}
              className="absolute inset-0 bg-dark-accent/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl relative z-10 p-8 no-scrollbar"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                   <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase tracking-widest border mb-3 inline-block ${getDepartmentColor(selectedPrompt.department)}`}>
                     {selectedPrompt.department}
                   </span>
                   <h3 className="text-2xl font-bold text-dark-accent mb-1">{selectedPrompt.name}</h3>
                   <p className="text-gray-500 text-sm">{selectedPrompt.description}</p>
                </div>
              </div>

              <div className="space-y-6">
                {Object.keys(placeholders).length > 0 && (
                   <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-4">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Fill Placeholders</h4>
                      {Object.keys(placeholders).map(ph => (
                         <div key={ph}>
                            <label className="text-xs font-bold text-gray-600 block mb-1">{ph}</label>
                            <input 
                               type="text"
                               placeholder={`Value for ${ph}...`}
                               value={placeholders[ph]}
                               onChange={(e) => setPlaceholders({...placeholders, [ph]: e.target.value})}
                               className="w-full p-3 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm mb-2"
                            />
                         </div>
                      ))}
                   </div>
                )}
                
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Prompt Template</label>
                  <textarea
                    className="w-full h-64 p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm font-mono bg-gray-50 leading-relaxed resize-y"
                    value={generateFilledPrompt()}
                    readOnly
                  />
                </div>
                
                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  <button 
                    onClick={() => handleCopyToast(generateFilledPrompt(), "Prompt copied! Paste into Google AI Studio.")}
                    className="flex-1 bg-primary text-white py-4 rounded-xl font-bold hover:bg-opacity-90 transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
                  >
                    <Zap size={18}/> Run in AI Studio
                  </button>
                  <button 
                    onClick={() => setSelectedPrompt(null)}
                    className="px-8 text-gray-500 bg-white border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 hover:text-gray-700 transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* CUSTOM PROMPT MODAL */}
        {showCustomModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCustomModal(false)}
              className="absolute inset-0 bg-dark-accent/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl relative z-10 p-8 no-scrollbar"
            >
               <h3 className="text-2xl font-bold text-dark-accent mb-2">Add Custom Prompt</h3>
               <p className="text-gray-500 text-sm mb-6">Create a reusable prompt for your team. Use brackets like [CLIENT_NAME] to create input placeholders.</p>
               
               <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Prompt Name</label>
                    <input 
                       type="text"
                       placeholder="E.g., Quarterly Review Summariser"
                       value={customPrompt.name || ''}
                       onChange={(e) => setCustomPrompt({...customPrompt, name: e.target.value})}
                       className="w-full p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Department</label>
                    <select 
                       value={customPrompt.department || 'HR'}
                       onChange={(e) => setCustomPrompt({...customPrompt, department: e.target.value})}
                       className="w-full p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm bg-white"
                    >
                       <option value="HR">HR</option>
                       <option value="Sales">Sales</option>
                       <option value="Finance">Finance</option>
                       <option value="Operations">Operations</option>
                       <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Description</label>
                    <input 
                       type="text"
                       placeholder="A short description of what it does..."
                       value={customPrompt.description || ''}
                       onChange={(e) => setCustomPrompt({...customPrompt, description: e.target.value})}
                       className="w-full p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Prompt Template</label>
                    <textarea 
                       placeholder="Write your prompt here... Use [VARIABLES] to create placeholders."
                       value={customPrompt.promptTemplate || ''}
                       onChange={(e) => setCustomPrompt({...customPrompt, promptTemplate: e.target.value})}
                       className="w-full h-48 p-4 rounded-xl border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-sm resize-none font-mono"
                    />
                  </div>
                  
                  <div className="flex gap-3 pt-6">
                    <button 
                      onClick={handleSaveCustomPrompt}
                      disabled={!customPrompt.name || !customPrompt.promptTemplate}
                      className="flex-1 bg-primary text-white py-4 rounded-xl font-bold hover:bg-opacity-90 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Custom Prompt
                    </button>
                    <button 
                      onClick={() => setShowCustomModal(false)}
                      className="px-8 text-gray-500 bg-white border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 hover:text-gray-700 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
               </div>
            </motion.div>
          </div>
        )}
        {/* GUIDE MODAL */}
        {showGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                 markGuideSeen();
              }}
              className="absolute inset-0 bg-dark-accent/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl relative z-10 p-8 no-scrollbar"
            >
               <div className="flex items-center gap-3 mb-6">
                 <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white shadow-lg">
                   <Zap size={24} fill="currentColor" />
                 </div>
                 <div>
                   <h3 className="text-2xl font-bold text-dark-accent">Welcome to BizAssist <span className="text-primary italic">AI</span></h3>
                   <p className="text-gray-500 text-sm">Your all-in-one AI corporate assistant</p>
                 </div>
               </div>
               
               <div className="space-y-6">
                 <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-800"><MessageSquare size={16} className="text-primary"/> 1. Smart Email Editor</h4>
                    <p className="text-sm text-gray-600">Draft professional emails, rewrite aggressive tones into polite corporate language, or generate quick replies. Just describe what you need, hit generate, and copy the result to your email client.</p>
                 </div>

                 <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-800"><Video size={16} className="text-primary"/> 2. Meeting Minutes Extractor</h4>
                    <p className="text-sm text-gray-600">Paste your raw, messy meeting transcripts or notes. The AI will automatically clean them up and extract action items, assigned owners, and key decisions into a structural format.</p>
                 </div>

                 <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-800"><Newspaper size={16} className="text-primary"/> 3. Text Summariser</h4>
                    <p className="text-sm text-gray-600">Got a long article, report, or slack thread? Paste it here to get a concise summary. Choose between a brief overview, detailed bullet points, or an executive summary.</p>
                 </div>

                 <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-800"><Search size={16} className="text-primary"/> 4. Document & Image Q&A</h4>
                    <p className="text-sm text-gray-600">Upload a PDF, Word doc, image, or text file. Ask the AI specific questions about the document's contents, and it will answer precisely, citing the exact source quote.</p>
                 </div>

                 <div className="bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                    <h4 className="font-bold flex items-center gap-2 mb-2 text-gray-800"><Bookmark size={16} className="text-primary"/> 5. Team Prompt Library</h4>
                    <p className="text-sm text-gray-600">A collection of ready-to-use professional prompts for HR, Sales, Finance, and Operations. Use our templates, fill in the blanks, or save your own custom prompts for the team.</p>
                 </div>
               </div>

               <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                 <button 
                   onClick={() => {
                      markGuideSeen();
                   }}
                   className="px-8 py-3 bg-primary text-white text-sm font-bold rounded-xl shadow-md hover:bg-opacity-90 transition-all"
                 >
                   Get Started
                 </button>
               </div>
            </motion.div>
          </div>
        )}

      </AnimatePresence>
    </div>
  );
}

const Lightning = Zap;
