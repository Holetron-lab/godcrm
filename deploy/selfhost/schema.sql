--
-- PostgreSQL database dump
--

\restrict XCcEZuAOoYNWyHStKEWipDPcmrH3r1pRE5oSZuHp3V3gNkZlhuUz5UbExZF7sB8

-- Dumped from database version 16.14 (Ubuntu 16.14-1.pgdg22.04+1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-1.pgdg22.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: _command_policies_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._command_policies_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM pg_notify('command_policies_changed', 'invalidate-all');
      RETURN COALESCE(NEW, OLD);
    END;
    $$;


--
-- Name: _command_policies_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._command_policies_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;


--
-- Name: _inflight_runs_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._inflight_runs_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$;


--
-- Name: _secrets_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._secrets_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM pg_notify('secrets_changed', OLD.key);
        RETURN OLD;
      ELSE
        PERFORM pg_notify('secrets_changed', NEW.key);
        RETURN NEW;
      END IF;
    END;
    $$;


--
-- Name: registry_provenance_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registry_provenance_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_table_type text;
  v_title      text;
BEGIN
  SELECT table_type INTO v_table_type
    FROM universal_tables
    WHERE id = NEW.table_id;

  IF v_table_type IS DISTINCT FROM 'documents_registry' THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION 'registry_provenance: created_by is NULL (table_id=%)', NEW.table_id
      USING ERRCODE = '23502';
  END IF;

  IF NEW.created_at IS NULL THEN
    RAISE EXCEPTION 'registry_provenance: created_at is NULL (table_id=%)', NEW.table_id
      USING ERRCODE = '23502';
  END IF;

  v_title := COALESCE(NULLIF(NEW.data->>'name', ''), NULLIF(NEW.data->>'title', ''));
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'registry_provenance: data.name/title is empty (table_id=%)', NEW.table_id
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: trim_widget_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trim_widget_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM user_widget_history
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM user_widget_history
      WHERE user_id = NEW.user_id
      ORDER BY accessed_at DESC
      LIMIT 50
    );
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: _app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._app_settings (
    id integer NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: _app_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._app_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _app_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._app_settings_id_seq OWNED BY public._app_settings.id;


--
-- Name: _chat_mutation_log_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._chat_mutation_log_config (
    id integer NOT NULL,
    table_id integer NOT NULL,
    column_key text NOT NULL,
    template text NOT NULL,
    event_type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: _chat_mutation_log_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._chat_mutation_log_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _chat_mutation_log_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._chat_mutation_log_config_id_seq OWNED BY public._chat_mutation_log_config.id;


--
-- Name: _command_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._command_audit (
    id integer NOT NULL,
    agent_id integer,
    space_id integer,
    tool_name text,
    command text,
    decision text NOT NULL,
    matched_rule_id integer,
    matched_source text NOT NULL,
    reason text,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT _command_audit_decision_chk CHECK ((decision = ANY (ARRAY['allow'::text, 'deny'::text]))),
    CONSTRAINT _command_audit_source_chk CHECK ((matched_source = ANY (ARRAY['code-level'::text, 'db-rule'::text, 'default-allow'::text])))
);


--
-- Name: _command_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._command_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _command_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._command_audit_id_seq OWNED BY public._command_audit.id;


--
-- Name: _command_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._command_policies (
    id integer NOT NULL,
    scope text NOT NULL,
    space_id integer,
    agent_id integer,
    tool_id integer,
    pattern text NOT NULL,
    match_type text DEFAULT 'prefix'::text NOT NULL,
    action text NOT NULL,
    actor integer,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT _command_policies_action_chk CHECK ((action = ANY (ARRAY['allow'::text, 'deny'::text]))),
    CONSTRAINT _command_policies_match_chk CHECK ((match_type = ANY (ARRAY['exact'::text, 'prefix'::text, 'regex'::text]))),
    CONSTRAINT _command_policies_scope_chk CHECK ((scope = ANY (ARRAY['global'::text, 'space'::text]))),
    CONSTRAINT _command_policies_scope_space CHECK ((((scope = 'global'::text) AND (space_id IS NULL)) OR ((scope = 'space'::text) AND (space_id IS NOT NULL))))
);


--
-- Name: _command_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._command_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _command_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._command_policies_id_seq OWNED BY public._command_policies.id;


--
-- Name: _inflight_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._inflight_runs (
    id bigint NOT NULL,
    ticket_id bigint,
    agent_slug text NOT NULL,
    conversation_id bigint,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_step_id bigint,
    status text DEFAULT 'running'::text NOT NULL,
    reason text,
    resume_at timestamp with time zone,
    resume_attempts integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT _inflight_runs_resume_attempts_chk CHECK (((resume_attempts >= 0) AND (resume_attempts <= 5))),
    CONSTRAINT _inflight_runs_status_chk CHECK ((status = ANY (ARRAY['running'::text, 'paused'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: _inflight_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._inflight_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _inflight_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._inflight_runs_id_seq OWNED BY public._inflight_runs.id;


--
-- Name: _secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._secrets (
    space_id integer DEFAULT 11 NOT NULL,
    id integer NOT NULL,
    key text NOT NULL,
    encrypted_payload jsonb NOT NULL,
    description text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_revealed_at timestamp with time zone,
    last_revealed_by integer
);


--
-- Name: _secrets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._secrets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _secrets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._secrets_id_seq OWNED BY public._secrets.id;


--
-- Name: _verification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._verification_attempts (
    id bigint NOT NULL,
    column_id integer NOT NULL,
    row_id bigint NOT NULL,
    user_id integer,
    method character varying(32),
    success boolean NOT NULL,
    error_code character varying(64),
    client_ip inet,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: _verification_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._verification_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _verification_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._verification_attempts_id_seq OWNED BY public._verification_attempts.id;


--
-- Name: agent_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_jobs (
    id integer NOT NULL,
    job_id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id integer NOT NULL,
    agent_row_id integer NOT NULL,
    agent_user_id integer,
    agent_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    trigger_message_id integer,
    trigger_user_id integer,
    context jsonb DEFAULT '{}'::jsonb,
    result_message text,
    result_metadata jsonb DEFAULT '{}'::jsonb,
    error_message text,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    worker_pid integer,
    created_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    timeout_at timestamp with time zone,
    worker_id text,
    heartbeat_at timestamp with time zone,
    recovered_from_job_id integer,
    restart_attempt integer DEFAULT 0 NOT NULL,
    invocation_type_norm text GENERATED ALWAYS AS (COALESCE((context ->> 'invocation_type'::text), 'default'::text)) STORED,
    CONSTRAINT chk_agent_jobs_status CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_jobs_id_seq OWNED BY public.agent_jobs.id;


--
-- Name: agent_workers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_workers (
    id integer NOT NULL,
    worker_id text NOT NULL,
    hostname text,
    ip_address text,
    os_type text DEFAULT 'linux'::text,
    arch text DEFAULT 'x86_64'::text,
    max_concurrent integer DEFAULT 3,
    current_jobs integer DEFAULT 0,
    status text DEFAULT 'online'::text,
    last_heartbeat timestamp with time zone DEFAULT now(),
    capabilities jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT agent_workers_os_type_check CHECK ((os_type = ANY (ARRAY['linux'::text, 'macos'::text, 'windows'::text]))),
    CONSTRAINT agent_workers_status_check CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text, 'draining'::text])))
);


--
-- Name: agent_workers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_workers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_workers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_workers_id_seq OWNED BY public.agent_workers.id;


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id integer NOT NULL,
    user_id integer NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    name text NOT NULL,
    scopes text DEFAULT '["*"]'::text,
    rate_limit integer DEFAULT 1000,
    last_used_at timestamp with time zone,
    request_count integer DEFAULT 0,
    expires_at timestamp with time zone,
    is_active integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    key_type text DEFAULT 'system'::text,
    provider_type text,
    project_id integer NOT NULL
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    user_id integer,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    details text,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    acting_as integer,
    request_id text,
    space_id integer,
    ip_addr inet
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: automation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_logs (
    id integer NOT NULL,
    automation_id integer NOT NULL,
    row_id integer,
    status text NOT NULL,
    trigger_data text,
    result_data text,
    error_message text,
    executed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    duration_ms integer
);


--
-- Name: automation_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_logs_id_seq OWNED BY public.automation_logs.id;


--
-- Name: automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automations (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    table_id integer NOT NULL,
    is_active integer DEFAULT 1,
    trigger_type text NOT NULL,
    trigger_config text,
    action_type text NOT NULL,
    action_config text,
    conditions text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: automations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automations_id_seq OWNED BY public.automations.id;


--
-- Name: table_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_rows (
    id integer NOT NULL,
    table_id integer NOT NULL,
    base_id text NOT NULL,
    data jsonb NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bdd_criteria_container_chk CHECK (((table_id <> 7256) OR ((data ->> 'spec_id'::text) IS NOT NULL) OR ((data ->> 'ticket_id'::text) IS NOT NULL)))
);


--
-- Name: bdd_doc_gate; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.bdd_doc_gate AS
 WITH specs AS (
         SELECT table_rows.id AS spec_id,
            ((table_rows.data ->> 'source_doc_id'::text))::integer AS source_doc_id,
            table_rows.updated_at AS spec_updated_at
           FROM public.table_rows
          WHERE ((table_rows.table_id = 7255) AND (table_rows.data ? 'source_doc_id'::text) AND ((table_rows.data ->> 'source_doc_id'::text) ~ '^-?\d+$'::text))
        ), criteria AS (
         SELECT table_rows.id AS criterion_id,
            ((table_rows.data ->> 'spec_id'::text))::integer AS spec_id,
            (table_rows.data ->> 'priority'::text) AS priority,
            (table_rows.data ->> 'status'::text) AS status,
            table_rows.updated_at AS criterion_updated_at
           FROM public.table_rows
          WHERE ((table_rows.table_id = 7256) AND (table_rows.data ? 'spec_id'::text) AND ((table_rows.data ->> 'spec_id'::text) ~ '^-?\d+$'::text))
        ), tests AS (
         SELECT table_rows.id AS test_id,
            ((table_rows.data ->> 'criterion_id'::text))::integer AS criterion_id
           FROM public.table_rows
          WHERE ((table_rows.table_id = 7258) AND (table_rows.data ? 'criterion_id'::text) AND ((table_rows.data ->> 'criterion_id'::text) ~ '^-?\d+$'::text))
        ), latest_runs AS (
         SELECT DISTINCT ON (t.criterion_id) t.criterion_id,
            r.id AS run_id,
            (r.data ->> 'status'::text) AS run_status,
            COALESCE((NULLIF((r.data ->> 'finished_at'::text), ''::text))::timestamp with time zone, r.updated_at) AS run_ts
           FROM (tests t
             JOIN public.table_rows r ON (((r.table_id = 7259) AND ((r.data ->> 'test_id'::text) ~ '^-?\d+$'::text) AND (((r.data ->> 'test_id'::text))::integer = t.test_id))))
          ORDER BY t.criterion_id, COALESCE((NULLIF((r.data ->> 'finished_at'::text), ''::text))::timestamp with time zone, r.updated_at) DESC
        )
 SELECT s.source_doc_id,
    s.spec_id,
    (count(*) FILTER (WHERE (c.priority = 'must'::text)))::integer AS must_total,
    (count(*) FILTER (WHERE ((c.priority = 'must'::text) AND (c.status = 'verified'::text))))::integer AS must_verified,
    (count(*) FILTER (WHERE ((c.priority = 'must'::text) AND (c.status = 'failed'::text))))::integer AS must_failed,
    ((count(*) FILTER (WHERE (c.priority = 'must'::text)) > 0) AND (count(*) FILTER (WHERE (c.priority = 'must'::text)) = count(*) FILTER (WHERE ((c.priority = 'must'::text) AND (c.status = 'verified'::text))))) AS ready,
    GREATEST(max(s.spec_updated_at), max(c.criterion_updated_at), max(lr.run_ts)) AS updated_at
   FROM ((specs s
     LEFT JOIN criteria c ON ((c.spec_id = s.spec_id)))
     LEFT JOIN latest_runs lr ON ((lr.criterion_id = c.criterion_id)))
  GROUP BY s.source_doc_id, s.spec_id;


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id integer NOT NULL,
    title character varying(500) NOT NULL,
    description text DEFAULT ''::text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    all_day smallint DEFAULT 0,
    space_id integer,
    created_by integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: calendar_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calendar_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_events_id_seq OWNED BY public.calendar_events.id;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    thread_id integer NOT NULL,
    sender_id integer NOT NULL,
    content_encrypted text NOT NULL,
    encryption_method text DEFAULT 'user_key'::text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_participants (
    id integer NOT NULL,
    thread_id integer NOT NULL,
    user_id integer NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: chat_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_participants_id_seq OWNED BY public.chat_participants.id;


--
-- Name: chat_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_threads (
    id integer NOT NULL,
    thread_id text NOT NULL,
    type text DEFAULT 'direct'::text,
    name text,
    encrypted_with_keys text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: chat_threads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_threads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_threads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_threads_id_seq OWNED BY public.chat_threads.id;


--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_participants (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    user_id integer NOT NULL,
    role text DEFAULT 'member'::text,
    user_type text DEFAULT 'human'::text,
    last_read_message_id integer,
    unread_count integer DEFAULT 0,
    is_muted integer DEFAULT 0,
    joined_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_read_at timestamp without time zone,
    agent_response_mode text,
    notification_overrides jsonb
);


--
-- Name: conversation_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_participants_id_seq OWNED BY public.conversation_participants.id;


--
-- Name: conversation_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_summaries (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    summary text NOT NULL,
    chunk_number integer NOT NULL,
    messages_start_id integer NOT NULL,
    messages_end_id integer NOT NULL,
    messages_count integer NOT NULL,
    summary_model character varying(100),
    embedding jsonb,
    embedding_model character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: conversation_summaries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_summaries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_summaries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_summaries_id_seq OWNED BY public.conversation_summaries.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    type text DEFAULT 'ai_chat'::text NOT NULL,
    title text,
    description text,
    created_by integer,
    space_id integer,
    agent_id integer,
    agent_table_id integer,
    bound_table_id integer,
    bound_row_id integer,
    last_message_id integer,
    last_message_at timestamp without time zone,
    last_message_preview text,
    messages_count integer DEFAULT 0,
    settings text DEFAULT '{}'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    lab_id integer,
    is_processing boolean DEFAULT false,
    processing_started_at timestamp without time zone,
    processing_agent_id integer,
    processing_agent_name text,
    sub_agents jsonb DEFAULT '[]'::jsonb,
    base_id text,
    parent_conversation_id bigint,
    purpose text,
    is_readonly boolean DEFAULT false NOT NULL
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboards (
    id integer NOT NULL,
    user_id integer,
    space_id integer,
    project_id integer,
    name text NOT NULL,
    description text,
    icon text DEFAULT '📊'::text,
    is_default integer DEFAULT 0,
    order_index integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_public boolean DEFAULT true NOT NULL
);


--
-- Name: dashboards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dashboards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dashboards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dashboards_id_seq OWNED BY public.dashboards.id;


--
-- Name: data_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_sources (
    id text,
    workspace_id text NOT NULL,
    created_by integer NOT NULL,
    name text NOT NULL,
    description text,
    type text NOT NULL,
    ssh_host text,
    ssh_port integer DEFAULT 22,
    ssh_username text,
    ssh_key_name text,
    db_host text,
    db_port integer,
    db_name text,
    db_username text,
    db_password_key text,
    last_test_at timestamp with time zone,
    last_test_status text,
    last_test_error text,
    sync_enabled integer DEFAULT 0,
    sync_interval_minutes integer DEFAULT 15,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: device_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_logs (
    id integer NOT NULL,
    device character varying(64) DEFAULT 'frame'::character varying NOT NULL,
    session_id character varying(128),
    app_version character varying(32),
    ble_state character varying(32),
    level character varying(8),
    category character varying(32),
    message text,
    event_ts timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: device_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_logs_id_seq OWNED BY public.device_logs.id;


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id text,
    name text NOT NULL,
    original_name text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    path text NOT NULL,
    url text,
    storage_provider_id text DEFAULT 'local'::text,
    space_id integer,
    project_id integer,
    table_id integer,
    row_id text,
    column_id text,
    uploaded_by integer,
    description text,
    metadata text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    visibility text DEFAULT 'private'::text NOT NULL,
    CONSTRAINT files_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'internal'::text, 'public'::text])))
);


--
-- Name: fitness_exercises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fitness_exercises (
    id integer NOT NULL,
    space_id integer,
    name character varying(255) NOT NULL,
    equipment character varying(100),
    primary_muscle character varying(100),
    secondary_muscle character varying(100),
    category character varying(50),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: fitness_exercises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fitness_exercises_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fitness_exercises_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fitness_exercises_id_seq OWNED BY public.fitness_exercises.id;


--
-- Name: fitness_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fitness_sets (
    id integer NOT NULL,
    workout_id integer,
    exercise_id integer,
    exercise_name character varying(255),
    set_index integer NOT NULL,
    set_type character varying(50) DEFAULT 'normal'::character varying,
    weight_kg numeric(7,2),
    reps integer,
    rpe numeric(3,1),
    distance_km numeric(7,3),
    duration_seconds integer,
    is_pr boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    notes text
);


--
-- Name: fitness_sets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fitness_sets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fitness_sets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fitness_sets_id_seq OWNED BY public.fitness_sets.id;


--
-- Name: fitness_workouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fitness_workouts (
    id integer NOT NULL,
    space_id integer NOT NULL,
    title character varying(255),
    description text,
    started_at timestamp without time zone NOT NULL,
    ended_at timestamp without time zone,
    notes text,
    source character varying(50) DEFAULT 'manual'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: fitness_workout_sets; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.fitness_workout_sets AS
 SELECT w.id AS workout_id,
    w.space_id,
    w.title AS workout_title,
    w.description AS workout_description,
    w.started_at,
    w.ended_at,
    w.notes AS workout_notes,
    w.source,
    s.id AS set_id,
    s.exercise_id,
    s.exercise_name,
    s.set_index,
    s.set_type,
    s.weight_kg,
    s.reps,
    s.rpe,
    s.distance_km,
    s.duration_seconds,
    s.is_pr
   FROM (public.fitness_workouts w
     JOIN public.fitness_sets s ON ((s.workout_id = w.id)));


--
-- Name: fitness_workouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fitness_workouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fitness_workouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fitness_workouts_id_seq OWNED BY public.fitness_workouts.id;


--
-- Name: folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folders (
    id integer NOT NULL,
    project_id integer NOT NULL,
    parent_folder_id integer,
    name text NOT NULL,
    icon text DEFAULT '📁'::text,
    color text,
    order_index integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: folders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: folders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.folders_id_seq OWNED BY public.folders.id;


--
-- Name: knex_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knex_migrations (
    id integer NOT NULL,
    name character varying(255),
    batch integer,
    migration_time timestamp with time zone
);


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knex_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;


--
-- Name: knex_migrations_lock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knex_migrations_lock (
    index integer NOT NULL,
    is_locked integer
);


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knex_migrations_lock_index_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;


--
-- Name: labs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labs (
    id integer NOT NULL,
    space_id integer,
    lab_id character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    settings jsonb DEFAULT '{}'::jsonb,
    ai_default_provider_id integer,
    ai_default_agent_id integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: labs_ai_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labs_ai_templates (
    id integer NOT NULL,
    mindworkflow_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    description text,
    system_prompt text,
    user_prompt_example text,
    inputs jsonb DEFAULT '[]'::jsonb,
    settings jsonb DEFAULT '{}'::jsonb,
    routing_config jsonb DEFAULT '{}'::jsonb,
    ai_agent_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: labs_ai_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.labs_ai_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: labs_ai_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.labs_ai_templates_id_seq OWNED BY public.labs_ai_templates.id;


--
-- Name: labs_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labs_edges (
    id integer NOT NULL,
    lab_id character varying(255) NOT NULL,
    edge_id character varying(255) NOT NULL,
    source_node_id character varying(255) NOT NULL,
    target_node_id character varying(255) NOT NULL,
    source_handle character varying(100),
    target_handle character varying(100),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: labs_edges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.labs_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: labs_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.labs_edges_id_seq OWNED BY public.labs_edges.id;


--
-- Name: labs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.labs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: labs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.labs_id_seq OWNED BY public.labs.id;


--
-- Name: labs_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labs_nodes (
    id integer NOT NULL,
    lab_id character varying(255) NOT NULL,
    node_id character varying(255) NOT NULL,
    type character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    content text,
    meta jsonb DEFAULT '{}'::jsonb,
    ai_config jsonb DEFAULT '{}'::jsonb,
    ai_agent_id integer,
    ai_provider_id integer,
    ai_routing_config jsonb DEFAULT '{}'::jsonb,
    ui_config jsonb DEFAULT '{}'::jsonb,
    ai_visible boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: labs_nodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.labs_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: labs_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.labs_nodes_id_seq OWNED BY public.labs_nodes.id;


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id integer NOT NULL,
    message_id integer NOT NULL,
    user_id integer NOT NULL,
    emoji text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: message_reactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_reactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_reactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_reactions_id_seq OWNED BY public.message_reactions.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    sender_id integer,
    sender_type text DEFAULT 'human'::text,
    role text NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'text'::text,
    agent_id integer,
    model_used text,
    tokens_in integer,
    tokens_out integer,
    latency_ms integer,
    parent_id integer,
    reply_count integer DEFAULT 0,
    bound_table_id integer,
    bound_row_id integer,
    mentions text DEFAULT '[]'::text,
    tool_results text,
    attachments text DEFAULT '[]'::text,
    is_edited integer DEFAULT 0,
    is_deleted integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb DEFAULT '{}'::jsonb,
    approval_status character varying(20),
    approved_by integer,
    approved_at timestamp without time zone,
    sender_kind text DEFAULT 'user'::text NOT NULL,
    sender_space_id bigint,
    pinned_at timestamp with time zone
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modules (
    id integer NOT NULL,
    widget_id integer NOT NULL,
    space_id integer NOT NULL,
    sidebar_order integer DEFAULT 0,
    sidebar_icon text,
    access_level text DEFAULT 'member'::text,
    is_pinned boolean DEFAULT false,
    is_default boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: modules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.modules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.modules_id_seq OWNED BY public.modules.id;


--
-- Name: monitoring_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_events (
    id integer NOT NULL,
    run_id text,
    event_type text NOT NULL,
    event_name text NOT NULL,
    "timestamp" integer NOT NULL,
    data text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: monitoring_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.monitoring_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: monitoring_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.monitoring_events_id_seq OWNED BY public.monitoring_events.id;


--
-- Name: monitoring_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_feedback (
    id integer NOT NULL,
    run_id text NOT NULL,
    score double precision,
    thumbs text,
    comment text,
    data text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: monitoring_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.monitoring_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: monitoring_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.monitoring_feedback_id_seq OWNED BY public.monitoring_feedback.id;


--
-- Name: monitoring_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_runs (
    id text,
    parent_run_id text,
    type text NOT NULL,
    name text,
    status text DEFAULT 'running'::text,
    input text,
    output text,
    error text,
    tokens_prompt integer DEFAULT 0,
    tokens_completion integer DEFAULT 0,
    cost double precision DEFAULT 0,
    duration_ms integer DEFAULT 0,
    model text,
    provider text,
    user_id text,
    user_props text,
    tags text,
    metadata text,
    params text,
    template_id text,
    runtime text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ended_at timestamp with time zone
);


--
-- Name: monitoring_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_threads (
    id text,
    user_id text,
    tags text,
    metadata text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: oidc_access_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oidc_access_tokens (
    id integer NOT NULL,
    token_hash text NOT NULL,
    client_id text NOT NULL,
    user_id integer NOT NULL,
    scope text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: oidc_access_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oidc_access_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oidc_access_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oidc_access_tokens_id_seq OWNED BY public.oidc_access_tokens.id;


--
-- Name: oidc_auth_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oidc_auth_codes (
    id integer NOT NULL,
    code text NOT NULL,
    client_id text NOT NULL,
    user_id integer NOT NULL,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    nonce text,
    expires_at timestamp without time zone NOT NULL,
    used integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: oidc_auth_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oidc_auth_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oidc_auth_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oidc_auth_codes_id_seq OWNED BY public.oidc_auth_codes.id;


--
-- Name: oidc_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oidc_clients (
    id integer NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    name text NOT NULL,
    redirect_uris text NOT NULL,
    allowed_scopes text DEFAULT '["openid", "profile", "email"]'::text,
    is_active integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: oidc_clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oidc_clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oidc_clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oidc_clients_id_seq OWNED BY public.oidc_clients.id;


--
-- Name: orchestrator_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestrator_saves (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    project character varying(100) DEFAULT 'HOLETRON'::character varying NOT NULL,
    context_summary text NOT NULL,
    knowledge_base jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: orchestrator_saves_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orchestrator_saves_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orchestrator_saves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orchestrator_saves_id_seq OWNED BY public.orchestrator_saves.id;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id integer NOT NULL,
    space_id integer,
    name text NOT NULL,
    description text,
    icon text,
    primary_table_id integer,
    type text NOT NULL,
    owner_id integer NOT NULL,
    theme_primary text DEFAULT '#0ea5e9'::text,
    theme_secondary text DEFAULT '#8b5cf6'::text,
    theme_tertiary text DEFAULT '#10b981'::text,
    settings text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    access_control text,
    order_index integer DEFAULT 0,
    owner_owner_id integer,
    is_public boolean DEFAULT true NOT NULL
);


--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: scheduled_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    sender_id integer NOT NULL,
    content text NOT NULL,
    content_type text DEFAULT 'text'::text,
    mentions text DEFAULT '[]'::text,
    attachments text DEFAULT '[]'::text,
    metadata text DEFAULT '{}'::text,
    scheduled_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text,
    sent_message_id integer,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: scheduled_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduled_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduled_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduled_messages_id_seq OWNED BY public.scheduled_messages.id;


--
-- Name: schema_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_layouts (
    id integer NOT NULL,
    space_id integer NOT NULL,
    layout text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: schema_layouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schema_layouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schema_layouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_layouts_id_seq OWNED BY public.schema_layouts.id;


--
-- Name: space_connectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.space_connectors (
    id integer NOT NULL,
    space_id integer NOT NULL,
    type_slug text NOT NULL,
    kind text NOT NULL,
    display_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    scopes_requested text[] DEFAULT '{}'::text[] NOT NULL,
    scopes_granted text[] DEFAULT '{}'::text[] NOT NULL,
    account_label text,
    encrypted_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_definition jsonb,
    expires_at timestamp with time zone,
    last_refresh_at timestamp with time zone,
    last_error text,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT space_connectors_custom_def_chk CHECK (((type_slug ~~ 'custom_%'::text) = (custom_definition IS NOT NULL))),
    CONSTRAINT space_connectors_kind_chk CHECK ((kind = ANY (ARRAY['oauth2'::text, 'api_key'::text]))),
    CONSTRAINT space_connectors_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'expired'::text, 'revoked'::text, 'error'::text])))
);


--
-- Name: space_connectors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.space_connectors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: space_connectors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.space_connectors_id_seq OWNED BY public.space_connectors.id;


--
-- Name: space_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.space_invitations (
    id integer NOT NULL,
    space_id integer NOT NULL,
    invited_by integer NOT NULL,
    invited_email text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: space_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.space_invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: space_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.space_invitations_id_seq OWNED BY public.space_invitations.id;


--
-- Name: spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spaces (
    id integer NOT NULL,
    owner_id integer NOT NULL,
    name text NOT NULL,
    description text,
    icon text DEFAULT '📁'::text,
    type text NOT NULL,
    theme_primary text DEFAULT '#0ea5e9'::text,
    theme_secondary text DEFAULT '#8b5cf6'::text,
    theme_tertiary text DEFAULT '#10b981'::text,
    settings text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    access_control text,
    tickets_config jsonb,
    files_config jsonb,
    visibility text DEFAULT 'internal'::text,
    public_slug text,
    public_password_hash text,
    favorites_config jsonb,
    notification_defaults jsonb
);


--
-- Name: spaces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.spaces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: spaces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.spaces_id_seq OWNED BY public.spaces.id;


--
-- Name: storage_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_providers (
    id text,
    name text NOT NULL,
    type text NOT NULL,
    is_default integer DEFAULT 0,
    is_enabled integer DEFAULT 1,
    config text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_logs (
    id integer NOT NULL,
    data_source_id text,
    table_id text NOT NULL,
    status text NOT NULL,
    new_records integer DEFAULT 0,
    updated_records integer DEFAULT 0,
    archived_records integer DEFAULT 0,
    total_active_records integer DEFAULT 0,
    error_message text,
    error_details text,
    duration_ms integer,
    synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_logs_id_seq OWNED BY public.sync_logs.id;


--
-- Name: system_form_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_form_configs (
    id integer NOT NULL,
    table_id integer NOT NULL,
    form_type text DEFAULT 'edit'::text NOT NULL,
    name text,
    config text DEFAULT '{}'::text NOT NULL,
    is_default integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_form_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_form_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_form_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_form_configs_id_seq OWNED BY public.system_form_configs.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key text,
    value text,
    type text DEFAULT 'string'::text,
    description text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: table_column_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_column_mappings (
    id integer NOT NULL,
    table_id integer NOT NULL,
    standard_field character varying(50) NOT NULL,
    column_name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: table_column_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_column_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_column_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_column_mappings_id_seq OWNED BY public.table_column_mappings.id;


--
-- Name: table_columns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_columns (
    id integer NOT NULL,
    table_id integer NOT NULL,
    column_name text NOT NULL,
    display_name text,
    type text NOT NULL,
    config text,
    order_index integer DEFAULT 0,
    is_visible integer DEFAULT 1,
    is_required integer DEFAULT 0,
    is_system integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_from_source integer DEFAULT 0,
    is_primary_key integer DEFAULT 0,
    is_locked integer DEFAULT 0,
    formula text,
    options text,
    required integer DEFAULT 0,
    unique_constraint integer DEFAULT 0,
    default_value text,
    is_readonly integer DEFAULT 0,
    width integer,
    min_width integer,
    max_width integer,
    mapping text
);


--
-- Name: table_columns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_columns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_columns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_columns_id_seq OWNED BY public.table_columns.id;


--
-- Name: table_rows_backup_1787_20260220; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.table_rows_backup_1787_20260220 (
    id integer,
    table_id integer,
    base_id text,
    data jsonb,
    created_by integer,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: table_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.table_rows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: table_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.table_rows_id_seq OWNED BY public.table_rows.id;


--
-- Name: tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tables (
    id integer NOT NULL,
    name text,
    display_name text,
    icon text
);


--
-- Name: terminal_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_commands (
    id integer NOT NULL,
    session_id integer NOT NULL,
    command text NOT NULL,
    output text,
    exit_code integer,
    risk_level character varying(20) DEFAULT 'safe'::character varying,
    approval_status character varying(20) DEFAULT 'auto'::character varying,
    approved_by integer,
    source character varying(20) DEFAULT 'user'::character varying,
    agent_name character varying(100),
    execution_time_ms integer,
    created_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone
);


--
-- Name: terminal_commands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terminal_commands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terminal_commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminal_commands_id_seq OWNED BY public.terminal_commands.id;


--
-- Name: terminal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(200) DEFAULT 'Terminal'::character varying,
    cwd character varying(500) DEFAULT '/root/production/business-crm'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: terminal_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terminal_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terminal_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminal_sessions_id_seq OWNED BY public.terminal_sessions.id;


--
-- Name: tool_approval_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_approval_rules (
    id integer NOT NULL,
    tool_name character varying(255) NOT NULL,
    tool_pattern character varying(255),
    risk_level character varying(20) DEFAULT 'medium'::character varying,
    requires_approval boolean DEFAULT true,
    auto_approve_for_agent_ids integer[],
    timeout_seconds integer DEFAULT 300,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT tool_approval_rules_risk_level_check CHECK (((risk_level)::text = ANY (ARRAY[('safe'::character varying)::text, ('medium'::character varying)::text, ('dangerous'::character varying)::text])))
);


--
-- Name: tool_approval_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_approval_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_approval_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_approval_rules_id_seq OWNED BY public.tool_approval_rules.id;


--
-- Name: universal_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.universal_tables (
    id integer NOT NULL,
    project_id integer NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    is_system integer DEFAULT 0,
    sync_target text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    data_source_id text,
    source_table_name text,
    source_id_column text,
    sync_enabled integer DEFAULT 0,
    parent_table_id integer,
    sync_interval_minutes integer DEFAULT 60,
    last_sync_at timestamp with time zone,
    display_name text,
    access_control text,
    show_in_nav integer DEFAULT 1,
    folder_id integer,
    order_index integer DEFAULT 0,
    color text,
    folder_path text,
    table_type text,
    base_id text,
    created_by integer,
    deleted_at timestamp with time zone,
    config text DEFAULT '{}'::text,
    is_public boolean DEFAULT true NOT NULL
);


--
-- Name: universal_tables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.universal_tables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: universal_tables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.universal_tables_id_seq OWNED BY public.universal_tables.id;


--
-- Name: user_access_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_access_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    space_id integer,
    project_id integer,
    table_id integer,
    column_id integer,
    access_level text DEFAULT 'viewer'::text NOT NULL,
    granted_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_access_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_access_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_access_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_access_permissions_id_seq OWNED BY public.user_access_permissions.id;


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    setting_key text NOT NULL,
    setting_value_encrypted text NOT NULL,
    setting_type text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_used_at timestamp with time zone
);


--
-- Name: user_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_settings_id_seq OWNED BY public.user_settings.id;


--
-- Name: user_widget_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_widget_favorites (
    id integer NOT NULL,
    user_id integer NOT NULL,
    widget_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_widget_favorites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_widget_favorites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_widget_favorites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_widget_favorites_id_seq OWNED BY public.user_widget_favorites.id;


--
-- Name: user_widget_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_widget_history (
    id integer NOT NULL,
    user_id integer NOT NULL,
    widget_id integer NOT NULL,
    accessed_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_widget_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_widget_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_widget_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_widget_history_id_seq OWNED BY public.user_widget_history.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    avatar text,
    role text DEFAULT 'user'::text,
    encryption_key_encrypted text NOT NULL,
    totp_secret text,
    totp_enabled integer DEFAULT 0,
    email_verification_code text,
    email_verified integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    user_type text DEFAULT 'human'::text,
    status text DEFAULT 'active'::text,
    managed_by_agent_table_id integer,
    managed_by_agent_row_id integer,
    agent_config jsonb DEFAULT '{}'::jsonb,
    telegram_user_id bigint
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: wa_auth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_auth_tokens (
    id integer NOT NULL,
    token character varying(64) NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: wa_auth_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wa_auth_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wa_auth_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wa_auth_tokens_id_seq OWNED BY public.wa_auth_tokens.id;


--
-- Name: wa_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_presence (
    id integer NOT NULL,
    user_id integer,
    room_id character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'online'::character varying,
    position_x integer,
    position_y integer,
    joined_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    left_at timestamp without time zone,
    last_activity_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: wa_presence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wa_presence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wa_presence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wa_presence_id_seq OWNED BY public.wa_presence.id;


--
-- Name: wa_room_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_room_access (
    id integer NOT NULL,
    room_pattern character varying(255) NOT NULL,
    is_public boolean DEFAULT true,
    required_role character varying(50),
    required_tags jsonb,
    map_url character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: wa_room_access_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wa_room_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wa_room_access_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wa_room_access_id_seq OWNED BY public.wa_room_access.id;


--
-- Name: webhook_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_logs (
    id integer NOT NULL,
    webhook_id integer NOT NULL,
    payload text,
    source_ip text,
    headers text,
    status text DEFAULT 'received'::text,
    error_message text,
    row_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    processed_at timestamp with time zone
);


--
-- Name: webhook_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_logs_id_seq OWNED BY public.webhook_logs.id;


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id integer NOT NULL,
    project_id integer NOT NULL,
    table_id integer,
    name text NOT NULL,
    description text,
    token text NOT NULL,
    is_active integer DEFAULT 1,
    auto_create_columns integer DEFAULT 1,
    flatten_payload integer DEFAULT 1,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    token_prefix character varying(16) NOT NULL,
    token_hash character(64) NOT NULL
);


--
-- Name: webhooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhooks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhooks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhooks_id_seq OWNED BY public.webhooks.id;


--
-- Name: wellness_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_achievements (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    icon character varying(100),
    category character varying(50),
    tier character varying(20) DEFAULT 'bronze'::character varying,
    condition jsonb NOT NULL,
    points_reward integer DEFAULT 50,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: wellness_achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_achievements_id_seq OWNED BY public.wellness_achievements.id;


--
-- Name: wellness_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_levels (
    id integer NOT NULL,
    space_id integer NOT NULL,
    current_level integer DEFAULT 1,
    total_xp integer DEFAULT 0,
    level_xp integer DEFAULT 0,
    title character varying(100) DEFAULT 'Beginner'::character varying,
    avatar_url text,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: wellness_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_levels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_levels_id_seq OWNED BY public.wellness_levels.id;


--
-- Name: wellness_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_points (
    id integer NOT NULL,
    space_id integer NOT NULL,
    earned_at timestamp without time zone DEFAULT now(),
    points integer NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id integer,
    reason character varying(255),
    metadata jsonb
);


--
-- Name: wellness_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_points_id_seq OWNED BY public.wellness_points.id;


--
-- Name: wellness_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_profiles (
    id integer NOT NULL,
    space_id integer NOT NULL,
    gender character varying(10),
    birth_date date,
    height_cm integer,
    target_weight_kg numeric(5,2),
    activity_level character varying(20),
    bmr integer,
    tdee integer,
    timezone character varying(50) DEFAULT 'UTC'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: wellness_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_profiles_id_seq OWNED BY public.wellness_profiles.id;


--
-- Name: wellness_streaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_streaks (
    id integer NOT NULL,
    space_id integer NOT NULL,
    streak_type character varying(50) NOT NULL,
    current_count integer DEFAULT 0,
    longest_count integer DEFAULT 0,
    last_activity_date date,
    started_at date,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: wellness_streaks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_streaks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_streaks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_streaks_id_seq OWNED BY public.wellness_streaks.id;


--
-- Name: wellness_user_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_user_achievements (
    id integer NOT NULL,
    space_id integer NOT NULL,
    achievement_id integer,
    earned_at timestamp without time zone,
    progress numeric(5,2) DEFAULT 0
);


--
-- Name: wellness_user_achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_user_achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_user_achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_user_achievements_id_seq OWNED BY public.wellness_user_achievements.id;


--
-- Name: wellness_vitals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellness_vitals (
    id integer NOT NULL,
    space_id integer NOT NULL,
    measured_at timestamp without time zone NOT NULL,
    vital_type character varying(50) NOT NULL,
    value numeric(10,3) NOT NULL,
    unit character varying(20),
    source character varying(50) DEFAULT 'manual'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: wellness_vitals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellness_vitals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellness_vitals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellness_vitals_id_seq OWNED BY public.wellness_vitals.id;


--
-- Name: widget_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widget_library (
    id integer NOT NULL,
    widget_id integer NOT NULL,
    space_id integer NOT NULL,
    is_public boolean DEFAULT false,
    is_template boolean DEFAULT false,
    use_count integer DEFAULT 0,
    last_used_at timestamp without time zone,
    tags text[],
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: widget_library_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.widget_library_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: widget_library_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.widget_library_id_seq OWNED BY public.widget_library.id;


--
-- Name: widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.widgets (
    id integer NOT NULL,
    dashboard_id integer,
    source_widget_id integer,
    widget_type text NOT NULL,
    preset_name text,
    code text,
    code_version integer DEFAULT 1,
    title text NOT NULL,
    description text,
    icon text DEFAULT '🧩'::text,
    config text DEFAULT '{}'::text NOT NULL,
    "position" text DEFAULT '{"x":0,"y":0,"w":6,"h":4}'::text NOT NULL,
    is_visible integer DEFAULT 1,
    order_index integer DEFAULT 0,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    folder_id integer,
    is_module boolean DEFAULT false,
    owner_kind character varying(32) NOT NULL,
    owner_id integer NOT NULL,
    is_template boolean DEFAULT false NOT NULL,
    is_public boolean DEFAULT true NOT NULL
);


--
-- Name: widgets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.widgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: widgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.widgets_id_seq OWNED BY public.widgets.id;


--
-- Name: _app_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._app_settings ALTER COLUMN id SET DEFAULT nextval('public._app_settings_id_seq'::regclass);


--
-- Name: _chat_mutation_log_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._chat_mutation_log_config ALTER COLUMN id SET DEFAULT nextval('public._chat_mutation_log_config_id_seq'::regclass);


--
-- Name: _command_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._command_audit ALTER COLUMN id SET DEFAULT nextval('public._command_audit_id_seq'::regclass);


--
-- Name: _command_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._command_policies ALTER COLUMN id SET DEFAULT nextval('public._command_policies_id_seq'::regclass);


--
-- Name: _inflight_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._inflight_runs ALTER COLUMN id SET DEFAULT nextval('public._inflight_runs_id_seq'::regclass);


--
-- Name: _secrets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._secrets ALTER COLUMN id SET DEFAULT nextval('public._secrets_id_seq'::regclass);


--
-- Name: _verification_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._verification_attempts ALTER COLUMN id SET DEFAULT nextval('public._verification_attempts_id_seq'::regclass);


--
-- Name: agent_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs ALTER COLUMN id SET DEFAULT nextval('public.agent_jobs_id_seq'::regclass);


--
-- Name: agent_workers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_workers ALTER COLUMN id SET DEFAULT nextval('public.agent_workers_id_seq'::regclass);


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: automation_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs ALTER COLUMN id SET DEFAULT nextval('public.automation_logs_id_seq'::regclass);


--
-- Name: automations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations ALTER COLUMN id SET DEFAULT nextval('public.automations_id_seq'::regclass);


--
-- Name: calendar_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events ALTER COLUMN id SET DEFAULT nextval('public.calendar_events_id_seq'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chat_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_participants ALTER COLUMN id SET DEFAULT nextval('public.chat_participants_id_seq'::regclass);


--
-- Name: chat_threads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_threads ALTER COLUMN id SET DEFAULT nextval('public.chat_threads_id_seq'::regclass);


--
-- Name: conversation_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants ALTER COLUMN id SET DEFAULT nextval('public.conversation_participants_id_seq'::regclass);


--
-- Name: conversation_summaries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_summaries ALTER COLUMN id SET DEFAULT nextval('public.conversation_summaries_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: dashboards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards ALTER COLUMN id SET DEFAULT nextval('public.dashboards_id_seq'::regclass);


--
-- Name: device_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_logs ALTER COLUMN id SET DEFAULT nextval('public.device_logs_id_seq'::regclass);


--
-- Name: fitness_exercises id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_exercises ALTER COLUMN id SET DEFAULT nextval('public.fitness_exercises_id_seq'::regclass);


--
-- Name: fitness_sets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_sets ALTER COLUMN id SET DEFAULT nextval('public.fitness_sets_id_seq'::regclass);


--
-- Name: fitness_workouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_workouts ALTER COLUMN id SET DEFAULT nextval('public.fitness_workouts_id_seq'::regclass);


--
-- Name: folders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders ALTER COLUMN id SET DEFAULT nextval('public.folders_id_seq'::regclass);


--
-- Name: knex_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);


--
-- Name: knex_migrations_lock index; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);


--
-- Name: labs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs ALTER COLUMN id SET DEFAULT nextval('public.labs_id_seq'::regclass);


--
-- Name: labs_ai_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_ai_templates ALTER COLUMN id SET DEFAULT nextval('public.labs_ai_templates_id_seq'::regclass);


--
-- Name: labs_edges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_edges ALTER COLUMN id SET DEFAULT nextval('public.labs_edges_id_seq'::regclass);


--
-- Name: labs_nodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_nodes ALTER COLUMN id SET DEFAULT nextval('public.labs_nodes_id_seq'::regclass);


--
-- Name: message_reactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions ALTER COLUMN id SET DEFAULT nextval('public.message_reactions_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: modules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules ALTER COLUMN id SET DEFAULT nextval('public.modules_id_seq'::regclass);


--
-- Name: monitoring_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitoring_events ALTER COLUMN id SET DEFAULT nextval('public.monitoring_events_id_seq'::regclass);


--
-- Name: monitoring_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitoring_feedback ALTER COLUMN id SET DEFAULT nextval('public.monitoring_feedback_id_seq'::regclass);


--
-- Name: oidc_access_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_access_tokens ALTER COLUMN id SET DEFAULT nextval('public.oidc_access_tokens_id_seq'::regclass);


--
-- Name: oidc_auth_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_auth_codes ALTER COLUMN id SET DEFAULT nextval('public.oidc_auth_codes_id_seq'::regclass);


--
-- Name: oidc_clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_clients ALTER COLUMN id SET DEFAULT nextval('public.oidc_clients_id_seq'::regclass);


--
-- Name: orchestrator_saves id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_saves ALTER COLUMN id SET DEFAULT nextval('public.orchestrator_saves_id_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: scheduled_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages ALTER COLUMN id SET DEFAULT nextval('public.scheduled_messages_id_seq'::regclass);


--
-- Name: schema_layouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_layouts ALTER COLUMN id SET DEFAULT nextval('public.schema_layouts_id_seq'::regclass);


--
-- Name: space_connectors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_connectors ALTER COLUMN id SET DEFAULT nextval('public.space_connectors_id_seq'::regclass);


--
-- Name: space_invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_invitations ALTER COLUMN id SET DEFAULT nextval('public.space_invitations_id_seq'::regclass);


--
-- Name: spaces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spaces ALTER COLUMN id SET DEFAULT nextval('public.spaces_id_seq'::regclass);


--
-- Name: sync_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_logs ALTER COLUMN id SET DEFAULT nextval('public.sync_logs_id_seq'::regclass);


--
-- Name: system_form_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_form_configs ALTER COLUMN id SET DEFAULT nextval('public.system_form_configs_id_seq'::regclass);


--
-- Name: table_column_mappings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_column_mappings ALTER COLUMN id SET DEFAULT nextval('public.table_column_mappings_id_seq'::regclass);


--
-- Name: table_columns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_columns ALTER COLUMN id SET DEFAULT nextval('public.table_columns_id_seq'::regclass);


--
-- Name: table_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_rows ALTER COLUMN id SET DEFAULT nextval('public.table_rows_id_seq'::regclass);


--
-- Name: terminal_commands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_commands ALTER COLUMN id SET DEFAULT nextval('public.terminal_commands_id_seq'::regclass);


--
-- Name: terminal_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_sessions ALTER COLUMN id SET DEFAULT nextval('public.terminal_sessions_id_seq'::regclass);


--
-- Name: tool_approval_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_approval_rules ALTER COLUMN id SET DEFAULT nextval('public.tool_approval_rules_id_seq'::regclass);


--
-- Name: universal_tables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universal_tables ALTER COLUMN id SET DEFAULT nextval('public.universal_tables_id_seq'::regclass);


--
-- Name: user_access_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_access_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_access_permissions_id_seq'::regclass);


--
-- Name: user_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings ALTER COLUMN id SET DEFAULT nextval('public.user_settings_id_seq'::regclass);


--
-- Name: user_widget_favorites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_favorites ALTER COLUMN id SET DEFAULT nextval('public.user_widget_favorites_id_seq'::regclass);


--
-- Name: user_widget_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_history ALTER COLUMN id SET DEFAULT nextval('public.user_widget_history_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: wa_auth_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_auth_tokens ALTER COLUMN id SET DEFAULT nextval('public.wa_auth_tokens_id_seq'::regclass);


--
-- Name: wa_presence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_presence ALTER COLUMN id SET DEFAULT nextval('public.wa_presence_id_seq'::regclass);


--
-- Name: wa_room_access id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_room_access ALTER COLUMN id SET DEFAULT nextval('public.wa_room_access_id_seq'::regclass);


--
-- Name: webhook_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_logs ALTER COLUMN id SET DEFAULT nextval('public.webhook_logs_id_seq'::regclass);


--
-- Name: webhooks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks ALTER COLUMN id SET DEFAULT nextval('public.webhooks_id_seq'::regclass);


--
-- Name: wellness_achievements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_achievements ALTER COLUMN id SET DEFAULT nextval('public.wellness_achievements_id_seq'::regclass);


--
-- Name: wellness_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_levels ALTER COLUMN id SET DEFAULT nextval('public.wellness_levels_id_seq'::regclass);


--
-- Name: wellness_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_points ALTER COLUMN id SET DEFAULT nextval('public.wellness_points_id_seq'::regclass);


--
-- Name: wellness_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_profiles ALTER COLUMN id SET DEFAULT nextval('public.wellness_profiles_id_seq'::regclass);


--
-- Name: wellness_streaks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_streaks ALTER COLUMN id SET DEFAULT nextval('public.wellness_streaks_id_seq'::regclass);


--
-- Name: wellness_user_achievements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_user_achievements ALTER COLUMN id SET DEFAULT nextval('public.wellness_user_achievements_id_seq'::regclass);


--
-- Name: wellness_vitals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_vitals ALTER COLUMN id SET DEFAULT nextval('public.wellness_vitals_id_seq'::regclass);


--
-- Name: widget_library id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_library ALTER COLUMN id SET DEFAULT nextval('public.widget_library_id_seq'::regclass);


--
-- Name: widgets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets ALTER COLUMN id SET DEFAULT nextval('public.widgets_id_seq'::regclass);


--
-- Name: _app_settings _app_settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._app_settings
    ADD CONSTRAINT _app_settings_key_unique UNIQUE (key);


--
-- Name: _app_settings _app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._app_settings
    ADD CONSTRAINT _app_settings_pkey PRIMARY KEY (id);


--
-- Name: _chat_mutation_log_config _chat_mutation_log_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._chat_mutation_log_config
    ADD CONSTRAINT _chat_mutation_log_config_pkey PRIMARY KEY (id);


--
-- Name: _command_audit _command_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._command_audit
    ADD CONSTRAINT _command_audit_pkey PRIMARY KEY (id);


--
-- Name: _command_policies _command_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._command_policies
    ADD CONSTRAINT _command_policies_pkey PRIMARY KEY (id);


--
-- Name: _inflight_runs _inflight_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._inflight_runs
    ADD CONSTRAINT _inflight_runs_pkey PRIMARY KEY (id);


--
-- Name: idx_secrets_space_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_secrets_space_key ON public._secrets USING btree (space_id, key);


--
-- Name: _secrets _secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._secrets
    ADD CONSTRAINT _secrets_pkey PRIMARY KEY (id);


--
-- Name: _verification_attempts _verification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._verification_attempts
    ADD CONSTRAINT _verification_attempts_pkey PRIMARY KEY (id);


--
-- Name: agent_jobs agent_jobs_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_job_id_key UNIQUE (job_id);


--
-- Name: agent_jobs agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: agent_workers agent_workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_workers
    ADD CONSTRAINT agent_workers_pkey PRIMARY KEY (id);


--
-- Name: agent_workers agent_workers_worker_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_workers
    ADD CONSTRAINT agent_workers_worker_id_key UNIQUE (worker_id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: conversation_participants conversation_participants_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_user_id_key UNIQUE (conversation_id, user_id);


--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (id);


--
-- Name: conversation_summaries conversation_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_summaries
    ADD CONSTRAINT conversation_summaries_pkey PRIMARY KEY (id);


--
-- Name: conversation_summaries conversation_summaries_conversation_id_chunk_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_summaries
    ADD CONSTRAINT conversation_summaries_conversation_id_chunk_number_unique UNIQUE (conversation_id, chunk_number);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: device_logs device_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_logs
    ADD CONSTRAINT device_logs_pkey PRIMARY KEY (id);


--
-- Name: fitness_exercises fitness_exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_exercises
    ADD CONSTRAINT fitness_exercises_pkey PRIMARY KEY (id);


--
-- Name: fitness_sets fitness_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_sets
    ADD CONSTRAINT fitness_sets_pkey PRIMARY KEY (id);


--
-- Name: fitness_workouts fitness_workouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_workouts
    ADD CONSTRAINT fitness_workouts_pkey PRIMARY KEY (id);


--
-- Name: knex_migrations_lock knex_migrations_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations_lock
    ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);


--
-- Name: knex_migrations knex_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations
    ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);


--
-- Name: labs_ai_templates labs_ai_templates_mindworkflow_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_ai_templates
    ADD CONSTRAINT labs_ai_templates_mindworkflow_id_key UNIQUE (mindworkflow_id);


--
-- Name: labs_ai_templates labs_ai_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_ai_templates
    ADD CONSTRAINT labs_ai_templates_pkey PRIMARY KEY (id);


--
-- Name: labs_edges labs_edges_lab_id_edge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_edges
    ADD CONSTRAINT labs_edges_lab_id_edge_id_key UNIQUE (lab_id, edge_id);


--
-- Name: labs_edges labs_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_edges
    ADD CONSTRAINT labs_edges_pkey PRIMARY KEY (id);


--
-- Name: labs labs_lab_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_lab_id_key UNIQUE (lab_id);


--
-- Name: labs_nodes labs_nodes_lab_id_node_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_nodes
    ADD CONSTRAINT labs_nodes_lab_id_node_id_key UNIQUE (lab_id, node_id);


--
-- Name: labs_nodes labs_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs_nodes
    ADD CONSTRAINT labs_nodes_pkey PRIMARY KEY (id);


--
-- Name: labs labs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labs
    ADD CONSTRAINT labs_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_message_id_user_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: modules modules_widget_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_widget_id_key UNIQUE (widget_id);


--
-- Name: oidc_access_tokens oidc_access_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_access_tokens
    ADD CONSTRAINT oidc_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: oidc_access_tokens oidc_access_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_access_tokens
    ADD CONSTRAINT oidc_access_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: oidc_auth_codes oidc_auth_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_auth_codes
    ADD CONSTRAINT oidc_auth_codes_code_key UNIQUE (code);


--
-- Name: oidc_auth_codes oidc_auth_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_auth_codes
    ADD CONSTRAINT oidc_auth_codes_pkey PRIMARY KEY (id);


--
-- Name: oidc_clients oidc_clients_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_clients
    ADD CONSTRAINT oidc_clients_client_id_key UNIQUE (client_id);


--
-- Name: oidc_clients oidc_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_clients
    ADD CONSTRAINT oidc_clients_pkey PRIMARY KEY (id);


--
-- Name: orchestrator_saves orchestrator_saves_conversation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_saves
    ADD CONSTRAINT orchestrator_saves_conversation_id_key UNIQUE (conversation_id);


--
-- Name: orchestrator_saves orchestrator_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_saves
    ADD CONSTRAINT orchestrator_saves_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: scheduled_messages scheduled_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id);


--
-- Name: space_connectors space_connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_connectors
    ADD CONSTRAINT space_connectors_pkey PRIMARY KEY (id);


--
-- Name: space_invitations space_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_invitations
    ADD CONSTRAINT space_invitations_pkey PRIMARY KEY (id);


--
-- Name: space_invitations space_invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_invitations
    ADD CONSTRAINT space_invitations_token_key UNIQUE (token);


--
-- Name: spaces spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);


--
-- Name: table_column_mappings table_column_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_column_mappings
    ADD CONSTRAINT table_column_mappings_pkey PRIMARY KEY (id);


--
-- Name: table_column_mappings table_column_mappings_table_id_standard_field_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_column_mappings
    ADD CONSTRAINT table_column_mappings_table_id_standard_field_key UNIQUE (table_id, standard_field);


--
-- Name: table_rows table_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.table_rows
    ADD CONSTRAINT table_rows_pkey PRIMARY KEY (id);


--
-- Name: tables tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_pkey PRIMARY KEY (id);


--
-- Name: terminal_commands terminal_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_commands
    ADD CONSTRAINT terminal_commands_pkey PRIMARY KEY (id);


--
-- Name: terminal_sessions terminal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_sessions
    ADD CONSTRAINT terminal_sessions_pkey PRIMARY KEY (id);


--
-- Name: tool_approval_rules tool_approval_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_approval_rules
    ADD CONSTRAINT tool_approval_rules_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_key_unique UNIQUE (user_id, setting_key);


--
-- Name: user_widget_favorites user_widget_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_favorites
    ADD CONSTRAINT user_widget_favorites_pkey PRIMARY KEY (id);


--
-- Name: user_widget_favorites user_widget_favorites_user_id_widget_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_favorites
    ADD CONSTRAINT user_widget_favorites_user_id_widget_id_key UNIQUE (user_id, widget_id);


--
-- Name: user_widget_history user_widget_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_history
    ADD CONSTRAINT user_widget_history_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wa_auth_tokens wa_auth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_auth_tokens
    ADD CONSTRAINT wa_auth_tokens_pkey PRIMARY KEY (id);


--
-- Name: wa_auth_tokens wa_auth_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_auth_tokens
    ADD CONSTRAINT wa_auth_tokens_token_key UNIQUE (token);


--
-- Name: wa_presence wa_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_presence
    ADD CONSTRAINT wa_presence_pkey PRIMARY KEY (id);


--
-- Name: wa_room_access wa_room_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_room_access
    ADD CONSTRAINT wa_room_access_pkey PRIMARY KEY (id);


--
-- Name: wellness_achievements wellness_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_achievements
    ADD CONSTRAINT wellness_achievements_pkey PRIMARY KEY (id);


--
-- Name: wellness_levels wellness_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_levels
    ADD CONSTRAINT wellness_levels_pkey PRIMARY KEY (id);


--
-- Name: wellness_levels wellness_levels_space_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_levels
    ADD CONSTRAINT wellness_levels_space_id_key UNIQUE (space_id);


--
-- Name: wellness_points wellness_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_points
    ADD CONSTRAINT wellness_points_pkey PRIMARY KEY (id);


--
-- Name: wellness_profiles wellness_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_profiles
    ADD CONSTRAINT wellness_profiles_pkey PRIMARY KEY (id);


--
-- Name: wellness_profiles wellness_profiles_space_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_profiles
    ADD CONSTRAINT wellness_profiles_space_id_key UNIQUE (space_id);


--
-- Name: wellness_streaks wellness_streaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_streaks
    ADD CONSTRAINT wellness_streaks_pkey PRIMARY KEY (id);


--
-- Name: wellness_streaks wellness_streaks_space_id_streak_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_streaks
    ADD CONSTRAINT wellness_streaks_space_id_streak_type_key UNIQUE (space_id, streak_type);


--
-- Name: wellness_user_achievements wellness_user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_user_achievements
    ADD CONSTRAINT wellness_user_achievements_pkey PRIMARY KEY (id);


--
-- Name: wellness_user_achievements wellness_user_achievements_space_id_achievement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_user_achievements
    ADD CONSTRAINT wellness_user_achievements_space_id_achievement_id_key UNIQUE (space_id, achievement_id);


--
-- Name: wellness_vitals wellness_vitals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_vitals
    ADD CONSTRAINT wellness_vitals_pkey PRIMARY KEY (id);


--
-- Name: widget_library widget_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_library
    ADD CONSTRAINT widget_library_pkey PRIMARY KEY (id);


--
-- Name: widget_library widget_library_widget_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_library
    ADD CONSTRAINT widget_library_widget_id_key UNIQUE (widget_id);


--
-- Name: widgets widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widgets
    ADD CONSTRAINT widgets_pkey PRIMARY KEY (id);


--
-- Name: _chat_mutation_log_config_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX _chat_mutation_log_config_enabled_idx ON public._chat_mutation_log_config USING btree (enabled) WHERE (enabled = true);


--
-- Name: _chat_mutation_log_config_table_col_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX _chat_mutation_log_config_table_col_uq ON public._chat_mutation_log_config USING btree (table_id, column_key);


--
-- Name: idx_agent_jobs_active_per_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_active_per_conv ON public.agent_jobs USING btree (conversation_id, status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_agent_jobs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_agent ON public.agent_jobs USING btree (agent_row_id);


--
-- Name: idx_agent_jobs_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_conversation ON public.agent_jobs USING btree (conversation_id);


--
-- Name: idx_agent_jobs_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_heartbeat ON public.agent_jobs USING btree (heartbeat_at);


--
-- Name: idx_agent_jobs_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_job_id ON public.agent_jobs USING btree (job_id);


--
-- Name: idx_agent_jobs_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_pending ON public.agent_jobs USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: idx_agent_jobs_recovery_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_agent_jobs_recovery_chain ON public.agent_jobs USING btree (recovered_from_job_id, restart_attempt) WHERE (recovered_from_job_id IS NOT NULL);


--
-- Name: idx_agent_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_status ON public.agent_jobs USING btree (status);


--
-- Name: idx_agent_jobs_worker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_jobs_worker ON public.agent_jobs USING btree (worker_id);


--
-- Name: idx_app_settings_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_settings_key ON public._app_settings USING btree (key);


--
-- Name: idx_atoms_v2_widget_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atoms_v2_widget_ref ON public.table_rows USING btree ((((data ->> 'widget_ref'::text))::integer)) WHERE ((table_id = 3574) AND (data ? 'widget_ref'::text));


--
-- Name: idx_audit_log_acting_as; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_acting_as ON public.audit_log USING btree (acting_as) WHERE (acting_as IS NOT NULL);


--
-- Name: idx_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_log_entity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity_created ON public.audit_log USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: idx_audit_log_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user_created ON public.audit_log USING btree (user_id, created_at DESC);


--
-- Name: idx_calendar_events_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_space ON public.calendar_events USING btree (space_id);


--
-- Name: idx_calendar_events_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calendar_events_start ON public.calendar_events USING btree (start_time);


--
-- Name: idx_command_audit_agent_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_audit_agent_ts ON public._command_audit USING btree (agent_id, ts DESC);


--
-- Name: idx_command_audit_deny_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_audit_deny_ts ON public._command_audit USING btree (ts DESC) WHERE (decision = 'deny'::text);


--
-- Name: idx_command_audit_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_audit_ts ON public._command_audit USING btree (ts DESC);


--
-- Name: idx_command_policies_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_policies_lookup ON public._command_policies USING btree (scope, space_id, agent_id, tool_id);


--
-- Name: idx_command_policies_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_policies_pattern ON public._command_policies USING btree (pattern);


--
-- Name: idx_conversations_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_created_by ON public.conversations USING btree (created_by);


--
-- Name: idx_conversations_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_parent ON public.conversations USING btree (parent_conversation_id) WHERE (parent_conversation_id IS NOT NULL);


--
-- Name: idx_conversations_parent_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_conversations_parent_purpose ON public.conversations USING btree (parent_conversation_id, purpose) WHERE ((purpose IS NOT NULL) AND (parent_conversation_id IS NOT NULL));


--
-- Name: idx_conversations_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_space ON public.conversations USING btree (space_id);


--
-- Name: idx_conversations_sub_agents; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_sub_agents ON public.conversations USING gin (sub_agents);


--
-- Name: idx_conversations_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_type ON public.conversations USING btree (type);


--
-- Name: idx_dashboards_project_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboards_project_public ON public.dashboards USING btree (project_id, is_public);


--
-- Name: idx_device_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_logs_created_at ON public.device_logs USING btree (created_at DESC);


--
-- Name: idx_device_logs_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_logs_device ON public.device_logs USING btree (device);


--
-- Name: idx_device_logs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_device_logs_session ON public.device_logs USING btree (session_id);


--
-- Name: idx_events_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_run ON public.monitoring_events USING btree (run_id);


--
-- Name: idx_favorites_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_user ON public.user_widget_favorites USING btree (user_id);


--
-- Name: idx_feedback_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_run ON public.monitoring_feedback USING btree (run_id);


--
-- Name: idx_fitness_exercises_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_fitness_exercises_unique ON public.fitness_exercises USING btree (space_id, name) WHERE (space_id IS NOT NULL);


--
-- Name: idx_fitness_sets_exercise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fitness_sets_exercise ON public.fitness_sets USING btree (exercise_name);


--
-- Name: idx_fitness_sets_pr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fitness_sets_pr ON public.fitness_sets USING btree (is_pr) WHERE (is_pr = true);


--
-- Name: idx_fitness_sets_workout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fitness_sets_workout ON public.fitness_sets USING btree (workout_id);


--
-- Name: idx_fitness_workouts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fitness_workouts_date ON public.fitness_workouts USING btree (space_id, started_at DESC);


--
-- Name: idx_fitness_workouts_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fitness_workouts_space ON public.fitness_workouts USING btree (space_id);


--
-- Name: idx_history_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_recent ON public.user_widget_history USING btree (user_id, accessed_at DESC);


--
-- Name: idx_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_history_user ON public.user_widget_history USING btree (user_id);


--
-- Name: idx_inflight_runs_agent_slug_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inflight_runs_agent_slug_status ON public._inflight_runs USING btree (agent_slug, status);


--
-- Name: idx_inflight_runs_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inflight_runs_conversation_id ON public._inflight_runs USING btree (conversation_id);


--
-- Name: idx_inflight_runs_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inflight_runs_reason ON public._inflight_runs USING btree (reason) WHERE (reason IS NOT NULL);


--
-- Name: idx_inflight_runs_status_resume_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inflight_runs_status_resume_at ON public._inflight_runs USING btree (status, resume_at);


--
-- Name: idx_labs_edges_lab; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labs_edges_lab ON public.labs_edges USING btree (lab_id);


--
-- Name: idx_labs_lab_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labs_lab_id ON public.labs USING btree (lab_id);


--
-- Name: idx_labs_nodes_lab; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labs_nodes_lab ON public.labs_nodes USING btree (lab_id);


--
-- Name: idx_labs_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labs_space ON public.labs USING btree (space_id);


--
-- Name: idx_messages_approval_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_approval_status ON public.messages USING btree (approval_status) WHERE (approval_status IS NOT NULL);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_pinned ON public.messages USING btree (conversation_id, pinned_at DESC) WHERE (pinned_at IS NOT NULL);


--
-- Name: idx_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_id);


--
-- Name: idx_modules_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_modules_space ON public.modules USING btree (space_id);


--
-- Name: idx_modules_widget; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_modules_widget ON public.modules USING btree (widget_id);


--
-- Name: idx_oidc_access_tokens_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oidc_access_tokens_hash ON public.oidc_access_tokens USING btree (token_hash);


--
-- Name: idx_oidc_auth_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oidc_auth_codes_code ON public.oidc_auth_codes USING btree (code);


--
-- Name: idx_oidc_clients_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oidc_clients_client_id ON public.oidc_clients USING btree (client_id);


--
-- Name: idx_participants_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_conversation ON public.conversation_participants USING btree (conversation_id);


--
-- Name: idx_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_user ON public.conversation_participants USING btree (user_id);


--
-- Name: idx_points_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_space ON public.wellness_points USING btree (space_id, earned_at DESC);


--
-- Name: idx_projects_space_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_space_public ON public.projects USING btree (space_id, is_public);


--
-- Name: idx_runs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_created ON public.monitoring_runs USING btree (created_at);


--
-- Name: idx_runs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_parent ON public.monitoring_runs USING btree (parent_run_id);


--
-- Name: idx_runs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_type ON public.monitoring_runs USING btree (type);


--
-- Name: idx_runs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_runs_user ON public.monitoring_runs USING btree (user_id);


--
-- Name: idx_scheduled_messages_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_messages_pending ON public.scheduled_messages USING btree (scheduled_at) WHERE (status = 'pending'::text);


--
-- Name: idx_secrets_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_secrets_key ON public._secrets USING btree (key);


--
-- Name: idx_space_connectors_refresh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_space_connectors_refresh ON public.space_connectors USING btree (expires_at) WHERE (status = 'active'::text);


--
-- Name: idx_space_connectors_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_space_connectors_space ON public.space_connectors USING btree (space_id);


--
-- Name: idx_space_connectors_space_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_space_connectors_space_type ON public.space_connectors USING btree (space_id, type_slug);


--
-- Name: idx_space_invitations_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_space_invitations_email ON public.space_invitations USING btree (invited_email);


--
-- Name: idx_space_invitations_space_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_space_invitations_space_id ON public.space_invitations USING btree (space_id);


--
-- Name: idx_space_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_space_invitations_token ON public.space_invitations USING btree (token);


--
-- Name: idx_spaces_public_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_spaces_public_slug ON public.spaces USING btree (public_slug) WHERE (public_slug IS NOT NULL);


--
-- Name: idx_streaks_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_streaks_space ON public.wellness_streaks USING btree (space_id);


--
-- Name: idx_summaries_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_summaries_conversation ON public.conversation_summaries USING btree (conversation_id);


--
-- Name: idx_table_rows_table_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_table_rows_table_id ON public.table_rows USING btree (table_id);


--
-- Name: idx_table_rows_table_id_base_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_table_rows_table_id_base_id ON public.table_rows USING btree (table_id, base_id);


--
-- Name: idx_terminal_commands_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terminal_commands_approval ON public.terminal_commands USING btree (approval_status) WHERE ((approval_status)::text = 'pending'::text);


--
-- Name: idx_terminal_commands_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terminal_commands_session ON public.terminal_commands USING btree (session_id, created_at DESC);


--
-- Name: idx_terminal_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terminal_sessions_user ON public.terminal_sessions USING btree (user_id, status);


--
-- Name: idx_tool_approval_rules_risk_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_approval_rules_risk_level ON public.tool_approval_rules USING btree (risk_level);


--
-- Name: idx_tool_approval_rules_tool_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_approval_rules_tool_name ON public.tool_approval_rules USING btree (tool_name);


--
-- Name: idx_universal_tables_project_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_universal_tables_project_public ON public.universal_tables USING btree (project_id, is_public);


--
-- Name: idx_users_telegram_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_telegram_user_id ON public.users USING btree (telegram_user_id) WHERE (telegram_user_id IS NOT NULL);


--
-- Name: idx_va_cooldown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_va_cooldown ON public._verification_attempts USING btree (column_id, row_id, attempted_at DESC);


--
-- Name: idx_va_user_attempts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_va_user_attempts ON public._verification_attempts USING btree (user_id, attempted_at DESC);


--
-- Name: idx_vitals_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vitals_latest ON public.wellness_vitals USING btree (space_id, vital_type, measured_at DESC);


--
-- Name: idx_vitals_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vitals_space ON public.wellness_vitals USING btree (space_id);


--
-- Name: idx_wa_auth_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_auth_tokens_expires ON public.wa_auth_tokens USING btree (expires_at);


--
-- Name: idx_wa_auth_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_auth_tokens_token ON public.wa_auth_tokens USING btree (token);


--
-- Name: idx_wa_presence_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_presence_room ON public.wa_presence USING btree (room_id);


--
-- Name: idx_wa_presence_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_presence_status ON public.wa_presence USING btree (status);


--
-- Name: idx_wa_presence_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_presence_user ON public.wa_presence USING btree (user_id);


--
-- Name: idx_widget_library_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_library_public ON public.widget_library USING btree (is_public);


--
-- Name: idx_widget_library_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_library_space ON public.widget_library USING btree (space_id);


--
-- Name: idx_widget_library_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widget_library_tags ON public.widget_library USING gin (tags);


--
-- Name: idx_widgets_dashboard_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_widgets_dashboard_public ON public.widgets USING btree (dashboard_id, is_public);


--
-- Name: users_agent_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_agent_ref_index ON public.users USING btree (managed_by_agent_table_id, managed_by_agent_row_id);


--
-- Name: users_user_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_user_type_index ON public.users USING btree (user_type);


--
-- Name: webhooks_token_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webhooks_token_hash_idx ON public.webhooks USING btree (token_hash);


--
-- Name: webhooks_token_prefix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhooks_token_prefix_idx ON public.webhooks USING btree (token_prefix);


--
-- Name: widgets_owner_kind_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX widgets_owner_kind_owner_id_idx ON public.widgets USING btree (owner_kind, owner_id);


--
-- Name: widgets_template_preset_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX widgets_template_preset_unique_idx ON public.widgets USING btree (preset_name) WHERE (is_template = true);


--
-- Name: _command_policies _command_policies_notify_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER _command_policies_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public._command_policies FOR EACH ROW EXECUTE FUNCTION public._command_policies_notify();


--
-- Name: _command_policies _command_policies_touch_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER _command_policies_touch_trg BEFORE UPDATE ON public._command_policies FOR EACH ROW EXECUTE FUNCTION public._command_policies_touch();


--
-- Name: _inflight_runs _inflight_runs_touch_updated_at_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER _inflight_runs_touch_updated_at_trg BEFORE UPDATE ON public._inflight_runs FOR EACH ROW EXECUTE FUNCTION public._inflight_runs_touch_updated_at();


--
-- Name: _secrets _secrets_notify_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER _secrets_notify_trg AFTER INSERT OR DELETE OR UPDATE ON public._secrets FOR EACH ROW EXECUTE FUNCTION public._secrets_notify();


--
-- Name: table_rows registry_provenance_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER registry_provenance_trg BEFORE INSERT OR UPDATE ON public.table_rows FOR EACH ROW EXECUTE FUNCTION public.registry_provenance_check();


--
-- Name: user_widget_history trim_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trim_history_trigger AFTER INSERT ON public.user_widget_history FOR EACH ROW EXECUTE FUNCTION public.trim_widget_history();


--
-- Name: agent_jobs agent_jobs_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.users(id);


--
-- Name: agent_jobs agent_jobs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: agent_jobs agent_jobs_recovered_from_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_recovered_from_job_id_fkey FOREIGN KEY (recovered_from_job_id) REFERENCES public.agent_jobs(id) ON DELETE SET NULL;


--
-- Name: agent_jobs agent_jobs_trigger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_trigger_user_id_fkey FOREIGN KEY (trigger_user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_acting_as_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_acting_as_fkey FOREIGN KEY (acting_as) REFERENCES public.users(id);


--
-- Name: calendar_events calendar_events_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_summaries conversation_summaries_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_summaries
    ADD CONSTRAINT conversation_summaries_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: fitness_exercises fitness_exercises_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_exercises
    ADD CONSTRAINT fitness_exercises_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: fitness_sets fitness_sets_exercise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_sets
    ADD CONSTRAINT fitness_sets_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.fitness_exercises(id);


--
-- Name: fitness_sets fitness_sets_workout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_sets
    ADD CONSTRAINT fitness_sets_workout_id_fkey FOREIGN KEY (workout_id) REFERENCES public.fitness_workouts(id) ON DELETE CASCADE;


--
-- Name: fitness_workouts fitness_workouts_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_workouts
    ADD CONSTRAINT fitness_workouts_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: modules modules_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: modules modules_widget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_widget_id_fkey FOREIGN KEY (widget_id) REFERENCES public.widgets(id) ON DELETE CASCADE;


--
-- Name: oidc_access_tokens oidc_access_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_access_tokens
    ADD CONSTRAINT oidc_access_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oidc_auth_codes oidc_auth_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_auth_codes
    ADD CONSTRAINT oidc_auth_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scheduled_messages scheduled_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: scheduled_messages scheduled_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: space_invitations space_invitations_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_invitations
    ADD CONSTRAINT space_invitations_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: terminal_commands terminal_commands_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_commands
    ADD CONSTRAINT terminal_commands_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: terminal_commands terminal_commands_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_commands
    ADD CONSTRAINT terminal_commands_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.terminal_sessions(id) ON DELETE CASCADE;


--
-- Name: terminal_sessions terminal_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_sessions
    ADD CONSTRAINT terminal_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: tool_approval_rules tool_approval_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_approval_rules
    ADD CONSTRAINT tool_approval_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: user_widget_favorites user_widget_favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_favorites
    ADD CONSTRAINT user_widget_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_widget_favorites user_widget_favorites_widget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_favorites
    ADD CONSTRAINT user_widget_favorites_widget_id_fkey FOREIGN KEY (widget_id) REFERENCES public.widgets(id) ON DELETE CASCADE;


--
-- Name: user_widget_history user_widget_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_history
    ADD CONSTRAINT user_widget_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_widget_history user_widget_history_widget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_widget_history
    ADD CONSTRAINT user_widget_history_widget_id_fkey FOREIGN KEY (widget_id) REFERENCES public.widgets(id) ON DELETE CASCADE;


--
-- Name: wa_auth_tokens wa_auth_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_auth_tokens
    ADD CONSTRAINT wa_auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: wa_presence wa_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_presence
    ADD CONSTRAINT wa_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: wellness_levels wellness_levels_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_levels
    ADD CONSTRAINT wellness_levels_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: wellness_points wellness_points_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_points
    ADD CONSTRAINT wellness_points_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: wellness_profiles wellness_profiles_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_profiles
    ADD CONSTRAINT wellness_profiles_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: wellness_streaks wellness_streaks_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_streaks
    ADD CONSTRAINT wellness_streaks_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: wellness_user_achievements wellness_user_achievements_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_user_achievements
    ADD CONSTRAINT wellness_user_achievements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.wellness_achievements(id);


--
-- Name: wellness_user_achievements wellness_user_achievements_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_user_achievements
    ADD CONSTRAINT wellness_user_achievements_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: wellness_vitals wellness_vitals_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellness_vitals
    ADD CONSTRAINT wellness_vitals_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: widget_library widget_library_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_library
    ADD CONSTRAINT widget_library_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);


--
-- Name: widget_library widget_library_widget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.widget_library
    ADD CONSTRAINT widget_library_widget_id_fkey FOREIGN KEY (widget_id) REFERENCES public.widgets(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict XCcEZuAOoYNWyHStKEWipDPcmrH3r1pRE5oSZuHp3V3gNkZlhuUz5UbExZF7sB8

