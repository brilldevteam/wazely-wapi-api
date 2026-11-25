import mongoose from 'mongoose';

const replyMaterialRefSchema = new mongoose.Schema({
    id: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'type',
        default: null
    },
    type: {
        type: String,
        enum: ['ReplyMaterial', 'Template', 'EcommerceCatalog', 'Sequence', 'Chatbot', 'AppointmentConfig', 'appointment'],
        default: 'ReplyMaterial'
    },
    variables_mapping: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    },
    media_url: {
        type: String,
        default: null
    },
    carousel_cards_data: [mongoose.Schema.Types.Mixed],
    coupon_code: String,
    catalog_id: String,
    product_retailer_id: String
}, { _id: false });


const wabaConfigurationSchema = new mongoose.Schema({
    waba_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WhatsappWaba',
        required: true,
        unique: true
    },
    out_of_working_hours: {
        type: replyMaterialRefSchema,
        default: () => ({})
    },
    welcome_message: {
        type: replyMaterialRefSchema,
        default: () => ({})
    },
    delayed_reply: {
        delay_minutes: { type: Number, default: 30 },
        id: { type: mongoose.Schema.Types.ObjectId, refPath: 'delayed_reply.type', default: null },
        type: { type: String, enum: ['ReplyMaterial', 'Template', 'EcommerceCatalog', 'Sequence', 'Chatbot', 'AppointmentConfig', 'appointment'], default: 'ReplyMaterial' },
        variables_mapping: {
            type: Map,
            of: mongoose.Schema.Types.Mixed,
            default: {}
        },
        media_url: String,
        carousel_cards_data: [mongoose.Schema.Types.Mixed],
        coupon_code: String,
        catalog_id: String,
        product_retailer_id: String
    },
    fallback_message: {
        type: replyMaterialRefSchema,
        default: () => ({})
    },
    reengagement_message: {
        type: replyMaterialRefSchema,
        default: () => ({})
    },
    round_robin_assignment: {
        type: Boolean,
        default: false
    },
    assignment_strategy: {
        type: String,
        enum: ['round_robin', 'least_open'],
        default: 'round_robin'
    },
    // Auto-assignment rules (used by Sequential assignment and flow "Assign Random Agent" steps).
    // When nobody is available, keep the chat waiting and hand it out when an agent becomes available.
    assignment_queue_enabled: {
        type: Boolean,
        default: true
    },
    // How long a chat may wait for an agent before it is left for manual assignment.
    assignment_wait_hours: {
        type: Number,
        default: 6,
        min: 1,
        max: 168
    },
    // 0 = no limit. Otherwise an agent with this many open chats gets no new auto-assigned chats.
    max_open_chats_per_agent: {
        type: Number,
        default: 0,
        min: 0,
        max: 1000
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'waba_configurations'
});



export default mongoose.model('WabaConfiguration', wabaConfigurationSchema);
