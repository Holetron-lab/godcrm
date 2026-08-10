-- GOD Frame Application Loop
-- Handles: tap events, audio capture, photo capture, text display
--
-- Message flags (must match Dart FrameFlags):
--   0x10 = tapFlag (Frame -> Phone)
--   0x11 = startListeningFlag (Phone -> Frame)
--   0x12 = stopListeningFlag (Phone -> Frame)
--   0x20 = messageResponseFlag (Phone -> Frame) - display text
--   0x22 = singleDataFlag (Phone -> Frame) - command dispatch
--   0x23 = holdResponseFlag (Phone -> Frame) - keep awake
--   0x05/0x06 = audio non-final/final (Frame -> Phone)
--   0x07/0x08 = photo non-final/final (Frame -> Phone)

local TAP_FLAG = 0x10
local START_LISTENING = 0x11
local STOP_LISTENING = 0x12
local MSG_RESPONSE = 0x20
local SINGLE_DATA = 0x22
local HOLD_RESPONSE = 0x23

local state = "idle"  -- idle, listening, wait_response, display
local last_msg_time = frame.time.utc()
local SLEEP_TIMEOUT = 120  -- seconds before auto-sleep (longer to prevent disconnect during recording)
local display_text = ""
local display_offset = 0
local events_text = ""  -- upcoming calendar events (up to 3 lines)

-- Enable tap detection
local function enable_taps()
    frame.imu.tap_callback(function()
        -- Send tap event to phone (both raw flag and framed for compatibility)
        -- Raw single byte — handled by Dart _handleRxData first-byte check
        frame.bluetooth.send(string.char(TAP_FLAG))
        last_msg_time = frame.time.utc()

        -- If we're in listening state, show "stopping..." feedback
        if state == "listening" then
            frame.display.clear()
            frame.display.text("stopping...", 170, 180)
            frame.display.show()
        end
    end)
end

-- Display text on Frame screen with wrapping
local function show_text(text)
    frame.display.clear()

    if text == nil or text == "" then
        frame.display.show()
        return
    end

    local max_chars_per_line = 32  -- approximate for 640px width
    local max_lines = 5            -- approximate for 400px height
    local y = 10
    local line_height = 75
    local line = 0

    local i = 1
    while i <= #text and line < max_lines do
        local end_pos = math.min(i + max_chars_per_line - 1, #text)

        -- Find word boundary for wrapping
        if end_pos < #text then
            local space = text:sub(1, end_pos):match(".*()%s")
            if space and space > i then
                end_pos = space
            end
        end

        local segment = text:sub(i, end_pos):gsub("^%s+", "")
        frame.display.text(segment, 10, y)

        y = y + line_height
        i = end_pos + 1
        line = line + 1
    end

    frame.display.show()
end

-- Show idle screen with optional calendar events
local function show_idle()
    frame.display.clear()

    if events_text ~= nil and events_text ~= "" then
        -- Show upcoming events (3 lines max)
        local y = 30
        local line_height = 75
        local line_count = 0

        for line in events_text:gmatch("[^\n]+") do
            if line_count >= 3 then break end
            -- First event: brighter/larger, rest: dimmer
            if line_count == 0 then
                frame.display.text("> " .. line, 10, y)
            else
                frame.display.text("  " .. line, 10, y)
            end
            y = y + line_height
            line_count = line_count + 1
        end

        -- Small hint at bottom
        frame.display.text("tap to speak", 180, 340)
    else
        frame.display.text("tap me in", 180, 160)
    end

    frame.display.show()
end

-- Show listening indicator
local function show_listening()
    frame.display.clear()
    frame.display.text("listening...", 160, 160)
    frame.display.text("tap to finish", 150, 240)
    frame.display.show()
end

-- Show processing indicator
local function show_processing()
    frame.display.clear()
    frame.display.text("thinking...", 170, 180)
    frame.display.show()
end

-- Handle incoming messages from phone
local function handle_messages(msg_code, data)
    last_msg_time = frame.time.utc()

    if msg_code == START_LISTENING then
        state = "listening"
        show_listening()
        -- Start microphone recording
        frame.microphone.start({
            sample_rate = 8000,
            bit_depth = 8
        })
        -- Auto-expose camera for photo capture
        frame.camera.auto({})

    elseif msg_code == STOP_LISTENING then
        state = "wait_response"
        show_processing()
        -- Stop microphone - audio data will be sent automatically
        frame.microphone.stop()
        -- Capture photo
        frame.camera.capture({})

    elseif msg_code == MSG_RESPONSE then
        state = "display"
        display_text = data or ""
        display_offset = 0
        show_text(display_text)

    elseif msg_code == HOLD_RESPONSE then
        -- Just keep awake, don't change state
        last_msg_time = frame.time.utc()

    elseif msg_code == SINGLE_DATA then
        -- Command dispatch based on first byte of data
        if data and #data > 0 then
            local cmd = string.byte(data, 1)
            if cmd == 0x01 then
                enable_taps()
            elseif cmd == 0x02 then
                -- Disable taps
                frame.imu.tap_callback(nil)
            elseif cmd == 0x03 then
                -- Update calendar events display
                events_text = #data > 1 and data:sub(2) or ""
                -- Refresh idle screen if currently idle
                if state == "idle" then
                    show_idle()
                end
            end
        end
    end
end

-- Register BLE message callback
frame.bluetooth.receive_callback(function(data)
    if data and #data >= 2 then
        local msg_code = string.byte(data, 1)
        local payload = #data > 1 and data:sub(2) or ""
        handle_messages(msg_code, payload)
    end
end)

-- Main loop
enable_taps()
show_idle()
state = "idle"

while true do
    -- Check for auto-sleep
    local now = frame.time.utc()
    if now - last_msg_time > SLEEP_TIMEOUT then
        if state == "idle" or state == "display" then
            frame.display.clear()
            frame.display.show()
            frame.sleep()
            -- Wake up resets
            last_msg_time = frame.time.utc()
            state = "idle"
            show_idle()
            enable_taps()
        end
    end

    -- Small delay to prevent busy loop
    frame.sleep(0.05)
end
